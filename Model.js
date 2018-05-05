const SyncManager = require('./SyncManager');
const clone = require('clone');
const DBRef = require('mongodb').DBRef;


// When calling it, make sure "this" is the object
function setPropByPath(prop, value) {
    if (typeof prop === "string")
        prop = prop.split(".");

    if (prop.length > 1) {
        var e = prop.shift();
        setPropByPath(this[e] =
                 Object.prototype.toString.call(this[e]) === "[object Object]"
                 ? this[e]
                 : {},
               prop,
               value);
    } else
        this[prop[0]] = value;
}

module.exports = function(options) {

  return new Promise( (resolve,reject)=> {

    SyncManager.init(options).then(

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
                                // Invoke the _error method on the object instance
                                target._error ("Trying to set unknown property: "+property+" (property value is left unchanged).");
                                return true;
                            }
                            else {
                                // Readonly
                                if (propDescrp.writable === false) {
                                    target._error ("Tried to set read-only property: "+property+" (property is left unchanged).");
                                }
                                // If not meta property
                                else if (! (property.indexOf('$')===0)) {
                                    // If the property is set to a DeriveJS object - save a DBRef instead
                                    if (value && value.hasOwnProperty('$_ModelInstance')) {
                                        value = new DBRef(value.$_ModelInstance,value._id);
                                    }
                                    // Add an Mongo Update call to the bulk operations
                                    syncManager.update (target, target._id, property, value, target[property]);
                                }
                                if (target.$Listen && target.$Listen.indexOf(property) > -1) {
                                    target.changed (property, value, target[property]);
                                }

                                return Reflect.set(target,property,value,receiver);
                            }
                        },
                        allowedGet: [ 'inspect', 'toBSON', 'toJSON', '_bsontype', 'then' ],
                        get: function(target, property, receiver) {
                            //console.log ("get: ",property," called on ",target);
                            if (typeof property === "symbol" || this.allowedGet.indexOf(property)>-1 || property.indexOf('$')===0)
                                return Reflect.get(target, property, receiver);

                            if (!Reflect.has(target,property) ) {
                                console.warn("WARNING: Tried to get unknown property: "+property);
                                //throw new ReferenceError('Trying to get unknown property: ',property);
                            }
                            return Reflect.get(target, property, receiver);
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
    
                                        if (value && value.hasOwnProperty('$_ModelInstance')) {
                                            value = new DBRef(value.$_ModelInstance,value._id);
                                        }

                                        
                                        syncManager.update (originalTarget, originalTarget._id, setPath, value, target[prop]);
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

            function Model(model,name,syncInterval, _syncer, _proxy) {

                var IndexProps = new Set(), UniqueIndexes = {}, Indexes = {};
                var MainIndex;
                var $DefaultCriteria = {};
                var PropDescrp = {}, descrp, value, criteria;

                // will contain the first unique index and first index
                var uniqueIndex = false, index = false;
                
                // Add secret boolean to know it's a model instance
                model.$_ModelInstance = name+"s";
                //if (!model.hasOwnProperty('$UpdateListen')) model.$UpdateListen = {};
                
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

                var ModelClass = 
                class {
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

                    /* Possibly will be implemented in future versions 
                    // Assigns functions in interf to the class instance
                    static implements(interf) {
                        //interf = inter.filter(f=>typeof f === "function");
                        var descrp, value;
                        for (var prop in interf) {
                            value = interf[prop];
                            if (typeof value !== "function") continue;
                            descrp = {
                                enumerable: false,
                                writable: false,
                                value: value
                            };
                            PropDescrp[prop] = descrp;
                        }
                    }
                    */

                    static clear(which) {
                        if (!syncManager.collection) return Promise.resolve();
                        return new Promise ( (resolve,reject)=> {
                            var criteria = ModelClass.$DefaultCriteria;
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }
                            syncManager.collection.remove(criteria)
                            .then(res=> {
                                if (res.result.ok==1) resolve()
                                else reject();
                            });
                        });
                    }

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

                        var proxy = new Proxy(this,proxyHandle.ModelHandler());

                        if (!syncManager.running) syncManager.run();

                        if (modelGet) {
                            modelGet =  null;
                        }
                        else {
                            syncManager.create(proxy);
                        }
                        return proxy;
                    }

                    _created() {
                        console.log (this[MainIndex]+" created");
                    }
                    _duplicate() {
                        console.log (this[MainIndex]+" has a duplicate key value!");
                    }
                    _error(msg) {
                        console.log ("Error in "+this[MainIndex]+": "+msg);
                    }
                    changed(property, newValue, oldValue) {
                        console.log (this[MainIndex]+":",property,"changed from",oldValue,"to",newValue);
                    }

                    $update (property, value, callback) {
                        //console.log ("ADDING UPDATE CALLBACK");
                        syncManager.addUpdateCallback(this._id, property, value, callback);
                        //setPropByPath.call(this, property, value);
                    }
                    static collection() {
                        return syncManager.collection;
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
                    static getAll(which,limit=0) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which;
                            }
                            var all = [], allDocs;
                            allDocs = syncManager.collection.find(criteria).limit(limit).toArray()
                            .then(alldocs=> {
                                alldocs.forEach(doc=> {
                                    modelGet = doc;
                                    all.push(new this());
                                });
                                resolve (all);

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

                    static map(which, index, returnArray) {
                        return new Promise( (resolve,reject)=> {
                            var criteria = Object.assign({},ModelClass.$DefaultCriteria);
                            if (which) {
                                if (typeof which === "object")
                                    Object.assign (criteria, which);
                                else 
                                    criteria[MainIndex] = which
                                
                            }
                            
                            if (!index) index = MainIndex;
                            var allmap, allDocs;
                            allmap = (returnArray ? [] : {});
                            allDocs = syncManager.collection.find(criteria).toArray()
                            .then(alldocs=> {
                                alldocs.forEach(doc=> {
                                    modelGet = doc;
                                    allmap[doc[index]] = new this();
                                });
                                resolve (allmap);
                            });
                        });
                    }


                    static has(which,returnDocument) {
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

                    static remodel(opts) {
                        if (!Object.keys(opts).length) return;

                        return new Promise ( (resolve,reject)=> {
                            var keys = Object.keys(model).filter(k=>(k.indexOf('$')!==0 && typeof model[k] !== "function")),
                                key, bulk = syncManager.collection.initializeUnorderedBulkOp(), value;
                            var renames = {}, isIndex;
                            
                            for (var i=0,len=keys.length;i<len;i++) {
                                key = keys[i];
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
                                    //console.log ("result: ",res.ok);
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
                Object.defineProperty (ModelClass, 'name', {value:name});
                // Set default criteria
                ModelClass.$DefaultCriteria = $DefaultCriteria;
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
