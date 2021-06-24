/* DO NOT extend Model class with an Event Emitter, as it will interfere with Proxy implementation */
const clone = require('lodash.clonedeep');
const DBRef = require('mongodb').DBRef;
const EventEmitter = require('events');

module.exports = function(options) {

  const DebugMode         = options.hasOwnProperty("debugMode") ? options.debugMode : true;
  const DefaultMethodsLog = options.hasOwnProperty("defaultMethodsLog") ? options.defaultMethodsLog : true;
  
  return new Promise( (resolve,reject)=> {

    require('./SyncConnector')(options).then(
        Syncer=> {
            // Handles proxying, per SyncManager
            class ProxyHandle {

                constructor(syncManager) {
                    this.syncManager = syncManager;
                }

                // A handler for the model instance proxy, to trap setters and getters
                ModelHandler() {
                    var syncManager = this.syncManager;
                    return {
                        set: function(target, property, value, receiver) {
                            // Always allow setting the _id property
                            if (property==="_id") return Reflect.set(target,property,value,receiver);
                            
                            var propDescrp = Reflect.getOwnPropertyDescriptor(target, property);
                            // If property not defined in model
                            if (!propDescrp) {
                                // Commented out as this triggers on 'sub properties' which don't have a property descriptor
                                // Invoke the _error method on the object instance
                                // target._error ("Trying to set unknown property: "+property+" (property value is left unchanged).");
                                // return true;
                            }
                            else {
                                // Readonly
                                if (propDescrp.writable === false) {
                                    target._error ("Tried to set read-only property: "+property+" (property is left unchanged).");
                                }
                                // If not meta property
                                else if (! (property.indexOf('$')===0)) {
                                    let callback  = false;
                                    let localOnly = false;
                                    if (value != null && typeof value === "object" && "$value" in value) {
                                            /*
                                            if (!"$callback" in value) {
                                                target._error ("Must use $callback when using object assignment with $value. $callback not found!");
                                                return false;
                                            }
                                            */
                                            // Special assignment with callback
                                            if ("$callback" in value) {
                                                // Make the callback "asynchronous"
                                                let $callback = value.$callback;
                                                callback = ()=> { setTimeout($callback.bind(target), 0) };
                                            }

                                            // This is a "local only" update (called when an update is triggered from an external source)
                                            if ("$localOnly" in value && value.$localOnly == true) localOnly = true;

                                            value = value.$value;
                                    }

                                    // If the property is set to a DeriveJS object - save a DBRef instead
                                    if (value && value.hasOwnProperty('$_ModelInstance')) {
                                        value = new DBRef(value.$_ModelInstance, value._id);
                                    }

                                    if (!localOnly) {
                                        // Add an Mongo Update call to the bulk operations, with optional update callback
                                        syncManager.update (target, target._id, property, value, target[property], callback);
                                    }
                                }

                                if (target.$Listen && target.$Listen.indexOf(property) > -1) {
                                    target.changed (property, value, target[property]);
                                }

                                return Reflect.set(target,property,value,receiver);
                            }
                        },
                        allowedGet: [ 'inspect', 'toBSON', 'toJSON', '_bsontype', 'then', '_created', 'length', '_id' ],
                        get: function(target, property, receiver) {
                            if (typeof property === "symbol" || this.allowedGet.indexOf(property)>-1 || property.indexOf('$')===0)
                                return Reflect.get(target, property, receiver);

                            if (!Reflect.has(target,property) ) {
                                console.warn("WARNING: Tried to get unknown property: "+property);
                            }
                            return Reflect.get(target, property, receiver);
                        },

                        deleteProperty(target, property) {
                            if (property==="_id") {
                                target._error ("Cannot unset _id property.");
                                return true;
                            }
                            var propDescrp = Reflect.getOwnPropertyDescriptor(target, property);
                            // If property not defined in model
                            if (!propDescrp) {
                                // Invoke the _error method on the object instance
                                target._error ("Trying to unset unknown property: "+property+" (property value is left unchanged).");
                                return true;
                            }

                            // Add an Mongo Update with unset call to the bulk operations
                            syncManager.unset (target, target._id, property);
                            return Reflect.deleteProperty(target, property);
                          }
                    }
                }

                PathHandler(path,originalTarget) {
                    var syncManager = this.syncManager;
                    return {
                        set(target, prop, value, receiver) {
                            if (!Array.isArray(target) && !(prop in target)) {
                                originalTarget._error ("Trying to set unknown property: "+prop+" (property value is left unchanged).");
                                return true;
                            }
                            else {
                                // If not meta property
                                if (! (prop.indexOf('$')===0)) {
                                    if (! (Array.isArray(target) && prop === "length" ) ) {
                                        var setPath = path+'.'+prop;

                                        let callback = false;
                                        // Special assignment with callback
                                        if (typeof value === "object" && "$value" in value) {
                                            if (!"$callback" in value) {
                                                target._error ("Must use $callback when using object assignment with $value. $callback not found!");
                                                return false;
                                            }
                                            callback = value.$callback;
                                            value = value.$value;
                                        }
    
                                        if (value && value.hasOwnProperty('$_ModelInstance')) {
                                            value = new DBRef(value.$_ModelInstance, value._id);
                                        }
                                        
                                        syncManager.update (originalTarget, originalTarget._id, setPath, value, target[prop], callback);
                                    }
                                }
                                if (originalTarget.$Listen && originalTarget.$Listen.indexOf(setPath) > -1) {
                                    originalTarget.changed (setPath, value, target[prop]);
                                }
                                return Reflect.set(target,prop,value,receiver);
                            }
                        }
                    }
                }

                proxify(obj,path,originalTarget) {
                    for (var p in obj) {
                        if (obj.constructor.name === "ObjectID") continue;
                        if (typeof obj[p] === "object" && obj[p] !== null) {
                            obj[p] = this.proxify (obj[p],path+'.'+p, originalTarget);
                        }
                    }
                    return new Proxy(obj,this.PathHandler(path, originalTarget));
                }
            }

            String.prototype.isUpperCase = function() {
                return (/[a-z]+?/.test(this) === false);
            }

            // Make sure to call with `this` as (proxied) Model instance
            function watchCollection (collection) {
                let collectionWatcher = collection.watch({ fullDocument: 'updateLookup' });

                // ChangeStream (collection watch) is only supported for Replica Sets
                // If not supported then dbevents will be triggered from SyncManager
                if (collectionWatcher.topology.s.clusterTime) {
                    const collectionInsertedHandler = changeData=> {
                        if (changeData.operationType != 'insert') return;
                        let id = changeData.documentKey._id;
                        if (this._id.toString() == id.toString()) {
                            // We make sure to pass `this` to events and callbacks, so the passed object will be a proxied (Derive) object.
                            this.$_dbEvents.emit("inserted", id, this);
                            if (this._inserted) this._inserted.call(this);
                            this.$_collectionWatcher.off("inserted", collectionInsertedHandler);
                        }
                    };
                    const collectionUpdateHandler = changeData=> {                        
                        if (changeData.operationType != 'update') return;
                        let id = changeData.documentKey._id;
                        if (this._id.toString() == id.toString()) {
                            let updatedFields = changeData.updateDescription.updatedFields;
                            if (changeData.updateDescription.hasOwnProperty('removedFields')) {
                                // fields that are unset
                                for (let removedField of changeData.updateDescription.removedFields)
                                    updatedFields[removedField] = null;
                            }
                            for (let field in updatedFields) 
                                this[field] = {
                                    $value: updatedFields[field],
                                    $localOnly: true
                                }
                            // We make sure to pass `this` to events and callbacks, so the passed object will be a proxied (Derive) object.                                    
                            this.$_dbEvents.emit("updated", changeData.documentKey._id, updatedFields, this);
                        }
                    };
                    collectionWatcher.on('error', error=> {
                        console.log (this.syncManager.collectionName + " watcher error: " + error);
                    });
                    collectionWatcher.on('change', collectionInsertedHandler);
                    collectionWatcher.on('change', collectionUpdateHandler);
                    return collectionWatcher;
                }
                return null;
            }


            function Model(model,name,syncInterval, _syncer, _proxy) {
                var IndexProps = new Set(), UniqueIndexes = {}, Indexes = {};
                var MainIndex;
                var $DefaultCriteria = {};
                var PropDescrp = {}, descrp, value, criteria;

                // will contain the first unique index and first index
                var uniqueIndex = false, index = false;
                
                model.$_ModelInstance = name+"s"; // Add secret boolean to know it's a model instance
                model.$_BARE = null; // Will be used to contain a "bare" object (unproxified)
                model.$_dbEvents = null; // Will be used for updated and inserted events
                model.$_collectionWatcher = null;

                for (var prop in model) {

                    criteria = false;
                    value = model[prop];

                    // item is a function, or "secret" property
                    if (typeof model[prop] === "function" || prop.indexOf('$')===0) {
                        descrp = {
                            enumerable: false,
                        }
                        if (prop.indexOf('$')===0)
                            descrp.writable = true;
                        else
                            descrp.writable = false;
                    }
                    else {
                        descrp = { enumerable: true };
                        descrp.writable = true;
                        // Properties ending with _ are added to $DefaultCriteria
                        if (prop.lastIndexOf('_') === prop.length-1) {
                            prop = prop.slice(0,-1);
                            criteria = true;
                        }
                        // Index
                        if (prop.indexOf('_')===0) {
                            if (prop.lastIndexOf('$') === prop.length-1) {
                                prop = prop.slice(0,-1);
                                UniqueIndexes[prop] = 1;
                                if (!uniqueIndex) uniqueIndex = prop;
                            }
                            else {
                                Indexes[prop] = 1;
                                if (!index) index = prop;
                            }
                            IndexProps.add(prop);
                        }
                    }
                    
                    descrp.value = value;
                    PropDescrp[prop] = descrp;
                    if (criteria) $DefaultCriteria[prop] = value;
                }

                MainIndex = uniqueIndex? uniqueIndex : (index?index:"_id");

                // If _proxy is true, then this is a derived class and no need for new SyncManager (use the existing one)
                if (!_proxy) {
                    var syncManager = new Syncer(name+"s", Indexes, UniqueIndexes, syncInterval)
                        proxyHandle = new ProxyHandle(syncManager);
                }
                else {
                    var syncManager = _syncer,
                        proxyHandle = _proxy
                }

                var modelGet = null;
                var indexProps = [...IndexProps];



                let ModelClass = class {
                //class ModelClass {

                    constructor() {
                        Object.defineProperties (this,clone(PropDescrp));
                        
                        var p;

                        // if has modelGet then this is a result of a static .get method, and we need to populate the values of the object with the returned values
                        if (modelGet) {
                            for (p in modelGet) {
                                this[p] = modelGet[p];
                            }
                        }
                        // Indexes can be set from constructor arguments
                        else if (arguments.length) {
                            for (var argI=0,arglen=arguments.length;argI<arglen;argI++) {
                                p = indexProps[argI];
                                this[p] = arguments[argI];
                            }
                        }

                        // Proxify object values
                        var objkeys = Object.keys(this).filter(k=>(typeof this[k] === "object" && this[k] !== null)), key;
                        for (var i=0,len=objkeys.length;i<len;i++) {
                            key = objkeys[i];
                            this[key] = proxyHandle.proxify(this[key],key,this); 
                        }

                        var readonly = Object.keys(this).filter(key => key.isUpperCase());
                        for (var i=0,len=readonly.length;i<len;i++) {
                            p = readonly[i];
                            Object.defineProperty (this, p, {writable:false});                            
                        }

                        // if (!syncManager.running) syncManager.run();

                        this.$_BARE = Object.assign ({}, this);
                        this.$_dbEvents = new EventEmitter();

                        if (modelGet) {
                            modelGet =  null;
                        }
                        else {
                            syncManager.create(this);
                        }
                        // proxy.$_BARE = Object.assign({}, proxy);
                        // proxy.$_dbEvents = new EventEmitter();
                        var proxy = new Proxy(this, proxyHandle.ModelHandler());

                        const collection = ModelClass.collection();
                        if (collection) proxy.$_collectionWatcher = watchCollection.call(proxy, collection);
                        // This can happen if a collection still doesn't exist
                        else {
                            ModelClass.collectionReady()
                            .then(_=> {
                                proxy.$_collectionWatcher = watchCollection.call(proxy, ModelClass.collection());                                
                            });
                        }

                        return proxy;
                    }

                    static mainIndex() {
                        return MainIndex;
                    }
                    
                    // Returns a "derived class" of ModelClass, extending the model with deriveModel
                    static derive(deriveModel) {

                        var m = clone(model);
                        // Delete overriden default criteria keys (ending with '_') from original model
                        var overridden = Object.keys(m).filter(k=>([k+'_'] in deriveModel));
                        for (var i=0,len=overridden.length;i<len;i++) {
                            delete m[overridden[i]];
                        }
                        var indexes = Object.keys(deriveModel).filter(k=>(k.indexOf('_')===0 && typeof deriveModel[k] !== 'function'));
                        var newIndexes = {}, newUniqueIndexes = {};

                        var k, hasNew = false;

                        for (var i=0,len=indexes.length;i<len;i++) {
                            k = indexes[i];
                            if (k.lastIndexOf('_')===k.length-1) k = k.slice(0,-1);
                            if (k.lastIndexOf('$')===k.length-1) {
                                k = k.slice(0,-1);
                                if ( ! IndexProps.has(k) ) {
                                    newUniqueIndexes[k] = 1;
                                    hasNew = true;
                                }
                            }
                            else {
                                if ( ! IndexProps.has(k) ) {
                                    newIndexes[k] = 1;
                                    hasNew = true;
                                }
                            }
                        }

                        if (hasNew)
                            syncManager.ensureIndexes(newIndexes, newUniqueIndexes, true);

                        var newmodel = Object.assign(m,deriveModel);
                        return Model (newmodel, name, syncInterval, syncManager, proxyHandle);
                    }

                    static use(mixin) {
                        var descrp, value;
                        for (var prop in mixin) {
                            value = mixin[prop];
                            if (typeof value !== "function") continue;
                            descrp = {
                                enumerable: false,
                                writable: false,
                                value: value
                            };
                            PropDescrp[prop] = descrp;
                        }
                    }

                    static clear(which) {
                        if (!syncManager.collection) return Promise.resolve();
                        return new Promise ( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (typeof which === "object" && which.constructor.name === "DBRef") {
                                criteria['_id'] = which.oid;
                            }
                            else {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }
                            syncManager.collection.deleteMany(criteria)
                            .then(res=> {
                                if (res.result.ok==1) resolve();
                                else reject();
                            });
                        });
                    }

                    _inserted() {
                        if (DefaultMethodsLog) console.log (this[MainIndex]+" inserted");
                    }
                    _isDuplicate() {
                        if (DefaultMethodsLog) console.log (this[MainIndex]+" has a duplicate key value!");
                    }
                    _error(msg) {
                        if (DefaultMethodsLog) console.log ("Error in "+this[MainIndex]+": "+msg);
                    }
                    changed(property, newValue, oldValue) {
                        if (DefaultMethodsLog) console.log (this[MainIndex]+":",property,"changed from",oldValue,"to",newValue);
                    }

                    static collection() {
                        return syncManager.collection;
                    }
                    static collectionReady() {
                        return new Promise ( (resolve,reject)=> {
                            if (syncManager.collection) resolve(true);
                            else syncManager.once("ready",()=> { resolve(true) });
                        });
                    }

                    static dereference(dbref) {
                        /*
                        if (dbref.namespace !== this.name+'s') {
                            console.warn ("Warning: trying to dereference a "+dbref.namespace+" DBRef from a different Model Class "+this.name);
                        }
                        */
                        return this.get({_id:dbref.oid});

                    }

                    // get functions
                    static get(which) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (typeof which === "object" && which.constructor.name === "DBRef") {
                                /*
                                if (which.namespace !== this.name+'s') {
                                    console.warn ("Warning: trying to dereference a "+which.namespace+" DBRef from a different Model Class "+this.name);
                                }
                                */
                                criteria['_id'] = which.oid;
                            }
                            else {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }
                            
                            // This can happen if the collection does not exist
                            if (!criteria) reject("get: Document "+(which._id?which._id:"")+" not found! (Does collection " + this.collectionName + " exists?)");

                            syncManager.collection.findOne(criteria)
                            .then(
                                doc=>{
                                    if (doc) {
                                        modelGet = doc;
                                        resolve (new this());
                                    }
                                    else reject("get: Document "+(which._id?which._id:"")+" not found!");
                                },
                                err=>{
                                    console.log ("model get error:",err);
                                    reject (err);
                                }
                            )
                            .catch(err=> {
                                console.log ("model get error catch:",err);
                                reject (err);
                            });
                        });
                    }

                    // sort by is an object of {index:<1 or -1>} s
                    static getAll(which,sortBy,limit=0,skip=0) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }

                            let sort = ( sortBy ? sortBy : {MainIndex:-1} );
                            var all = [], allDocs;

                            if (!criteria) reject("getAll: invalid criteria! (Does collection " + this.collectionName + " exists?)");
                            allDocs = syncManager.collection.find(criteria,{
                                sort:sort,
                                skip:skip,
                                limit:limit
                            }).toArray()
                            .then(alldocs=> {
                                alldocs.forEach(doc=> {
                                    modelGet = doc;
                                    all.push(new this());
                                });
                                resolve (all);
                            });
                        });
                    }

                    static getAllRead(which,sortBy,limit=0,skip=0) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }

                            let sort = ( sortBy ? sortBy : {MainIndex:-1} );
                            var allDocs;

                            if (!criteria) reject("getAll: invalid criteria! (Does collection " + this.collectionName + " exists?)");
                            allDocs = syncManager.collection.find(criteria,{
                                sort:sort,
                                skip:skip,
                                limit:limit
                            }).toArray()
                            .then(allDocs=> {
                                resolve(allDocs);
                            });
                        });
                    }

                    
                    static map(which, index, returnArray, limit=0, skip=0) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which
                                
                            }
                            
                            if (!index) index = MainIndex;
                            var allmap;
                            allmap = (returnArray ? [] : {});
                            syncManager.collection.find(criteria, {skip, limit}).toArray()
                            .then(alldocs=> {
                                alldocs.forEach(doc=> {
                                    modelGet = doc;
                                    allmap[doc[index]] = new this();
                                });
                                resolve (allmap);
                            });
                        });
                    }

                    static mapRead(which, index, returnArray, limit=0, skip=0) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which
                                
                            }
                            
                            if (!index) index = MainIndex;
                            var allmap;
                            allmap = (returnArray ? [] : {});
                            syncManager.collection.find(criteria, {skip, limit}).toArray()
                            .then(alldocs=> {
                                alldocs.forEach(doc=> {
                                    allmap[doc[index]] = doc;
                                });
                                resolve (allmap);
                            });
                        });
                    }

                    static join(which,joinWith,localField,foreignField,joinAs,returnAsModel=false) {
                        var thisclass = this;
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (typeof which === "object" && which.constructor.name === "DBRef") {
                                criteria['_id'] = which.oid;
                            }
                            else {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }
                            syncManager.collection.aggregate([
                                { $match: criteria },
                                {
                                    $lookup:
                                    {
                                        from: joinWith,
                                        localField: localField,
                                        foreignField: foreignField,
                                        as: joinAs
                                    }

                                },
                                { $unwind : "$"+joinAs }
                            ], async function (err, cursor) {
                                if (err) {
                                    console.log ("join error:",err);
                                    reject (err);
                                    return;
                                }
                                let doc = await cursor.toArray();
                                if (doc && doc.length) {
                                    if (returnAsModel) {
                                        modelGet = doc[0];
                                        resolve (new thisclass());
                                    }
                                    else {
                                        resolve(doc[0]);
                                    }
                                }
                                else reject("join: Document "+(which._id?which._id:"")+" not found!");
                            });
                        });
                    }

                    static joinAll(which, joinOpts, findOpts, returnAsModel=false) {
                        //joinWith,localField,foreignField,joinAs,returnAsModel=false) {
                        var thisclass = this;
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (typeof which === "object" && which.constructor.name === "DBRef") {
                                criteria['_id'] = which.oid;
                            }
                            else {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }
                            let sort = ( findOpts && findOpts.sortBy ? findOpts.sortBy : {MainIndex:-1} );
                            let aggregate = [
                            { $match: criteria },
                            {
                                $lookup:
                                {
                                    from: joinOpts.joinWith,
                                    localField: joinOpts.localField,
                                    foreignField: joinOpts.foreignField,
                                    as: joinOpts.joinAs
                                }
                            },
                            { $unwind : "$"+joinOpts.joinAs },
                            { $sort: sort }];

                            if (findOpts) {
                                if (findOpts.hasOwnProperty('skip')) aggregate.push({ $skip: findOpts.skip });
                                if (findOpts.hasOwnProperty('limit')) aggregate.push({ $limit: findOpts.limit });
                            }

                            syncManager.collection.aggregate(aggregate, 
                            async function (err, cursor) {
                                if (err) {
                                    console.log ("join error:",err);
                                    reject (err);
                                    return;
                                }
                                let docs = await cursor.toArray();
                                if (docs && docs.length) {
                                    if (returnAsModel) {
                                        var all = [];
                                        docs.forEach(doc=> {
                                            modelGet = doc;
                                            all.push(new thisclass());
                                        });
                                        resolve (all);
                                    }
                                    else {
                                        resolve(docs);
                                    }
                                }
                                else reject("join: Document "+(which._id?which._id:"")+" not found!");
                            });
                        });
                    }

                    static setAll(which, property, value) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }

                            syncManager.collection.updateMany (
                                criteria,
                                { $set: { [property]: value } },
                                { upsert: false }
                            ).then(res=> {
                                resolve();
                            });
                        });
                    }

                    static unsetAll(which, property) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }

                            syncManager.collection.updateMany (
                                criteria,
                                { $unset: { [property]: "" } },
                                { upsert: false }
                            ).then(res=> {
                                resolve();
                            });
                        });
                    }

                    static has(which, returnDocument) {
                        return new Promise ( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which
                            }
                            var cur = syncManager.collection.find(criteria).limit(1);

                            cur.hasNext()
                            .then(
                                has=> {
                                    if (has && returnDocument) {
                                        cur.next().then(doc=> {
                                            modelGet = doc;
                                            resolve (new this());
                                        })
                                    }
                                    else
                                        resolve(has); 
                                },
                                err=> { reject(err); }
                            );
                        });
                    }

                    static count(which) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which
                                
                            }
                            syncManager.collection.countDocuments(criteria)
                            .then(count=> {
                                resolve(count);
                            });                            
                        });
                    }

                    static remodel(opts) {
                        if (!Object.keys(opts).length) return;

                        return new Promise ( (resolve,reject)=> {
                            var keys = Object.keys(model).filter(k=>(k.indexOf('$')!==0 && typeof model[k] !== "function")),
                                key, bulk = syncManager.collection.initializeUnorderedBulkOp(), value;
                            var renames = {}, isIndex;
                            
                            for (var i=0,len=keys.length;i<len;i++) {
                                key = keys[i];
                                console.log ("Remodeling key "+key);
                                value = model[key]
                                if (key.lastIndexOf('_') === key.length-1) key = key.slice(0,-1);
                                if (key.lastIndexOf('$') === key.length-1) key = key.slice(0,-1);
                                if (opts.hasOwnProperty('deep') && opts.deep === true) {
                                    bulk.find( { [key]: {$exists:false} } ).update( {$set: { [key]: value }}, {multi:true} );
                                }
                                isIndex = (key.indexOf('_') === 0);
                                if (opts.hasOwnProperty('renameIndexes') && opts.renameIndexes===true) {
                                    if (isIndex)
                                        renames[key.substr(1)] = key;
                                    else
                                        renames['_'+key] = key;
                                }
                                if (opts.hasOwnProperty('renameDupes') && opts.renameDupes===true && isIndex) {
                                        bulk.find( { [key]: {$exists:true} } ).update({ $rename: { [key]:"old-"+key } });
                                }
                            }
                            if (Object.keys(renames).length)
                                bulk.find( {} ).update({ $rename: renames } );

                            bulk.execute()
                            .then(
                                res=> {
                                    resolve(res.ok);
                                },
                                err=>{
                                    reject (err);
                                }
                            );
                        });
                    }

                    static syncStop() {
                        syncManager.stop();
                    }
                    static syncRun() {
                        syncManager.run();
                    }
                }

                // Set constructor.name
                Object.defineProperty (ModelClass, 'name', { value:name });
                // Set default criteria
                ModelClass.$DefaultCriteria = $DefaultCriteria;

                // Multithread mode requires getting a reference to the collection on the Syncer class (SyncConnector)
                // THIS MEANS THAT IN MULTITHREADED MODE THE MODEL FUNCTION RETURNS A PROMISE!
                /*
                if (options.multiThreaded) {
                    return new Promise((resolve,reject)=> {
                        syncManager.getCollection(name+"s")
                        .then(()=> { 
                            resolve(ModelClass); 
                        });
                    });
                }
                else {
                    return ModelClass;
                }
                */
                /* If we want to trap the constructor at some point
                return new Proxy(ModelClass, {
                    construct: function(target, argumentsList, newTarget) {
                        console.log ("Constructor: ");
                        console.dir (target.name,    { depth: null} );
                        console.dir (newTarget.name, { depth: null} );
                        return Reflect.construct(target, argumentsList, newTarget);
                    },
                });
                */

               return ModelClass;

            }

            resolve (Model);
        },

        err=> {
            console.log ("Error in module Model: ",err);
        }
    )
    .catch(err=>{
            console.log ("Error catch in module Model: ",err);
    });
 });
}