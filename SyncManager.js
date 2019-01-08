const MongoClient = require('mongodb').MongoClient,
      ModelMapper = require('./MongoModelMapper'),
      EventEmitter = require('events');


class Update {
    constructor(operation, callback) {
        this.operation = operation;
        this.callback = callback;
    }
}
var SyncManager = {

    dbUrl: "mongodb://localhost:27017/", //deriveDB",
    dbName: "deriveDB",
    debugMode: true,

    dbOptions: {
        w:1, 
        native_parser:true, 
        forceServerObjectId:true
    },

    Mapper: ModelMapper,
    init: function(options) {

        if (options) {
                if (typeof options === "string") {
                    this.dbUrl = options
                }
                else if (typeof options === "object")
                    for (var o in options)
                        this[o] = options[o];
        }

        return new Promise ( (resolve,reject)=> {

            MongoClient
            .connect( this.dbUrl )
            .then(client=>client.db(this.dbName))
            .then(

                async db=> {

                    var DebugMode = this.debugMode;

                    function findByIndexInArray(arr, i) {
                        return arr.find(function(item) {
                            return item.index == i;
                        });
                    }

                    // In an array of objects having a 'name' property - will return the index-array of the object with name
                    function findIndexByName(name,arr) {
                        return arr.findIndex(function(obj) {
                            return (obj.name === name);
                        });
                    }

                    var COLLECTIONS = await db.listCollections().toArray();
                    COLLECTIONS = COLLECTIONS.map(c=> c.name);

                    var SyncerClass = class extends EventEmitter {

                        ensureIndexes(indexes, uniqueIndexes, sparse) {

                            /* This should be the indexes in the collection (by array index): 
                                0: _id index
                                1: a compound index of non-sparse non-unique indexes
                                2: a compound index of non-sparse unique indexes
                                3: a compound index of sparse non unique indexes
                                4: a compound index of sparse unique indexes    
                            */

                            var nonUniqueLocalKeys = Object.keys(indexes),
                                uniqueLocalKeys = Object.keys(uniqueIndexes);
                            var nonUniqueName = ( sparse ? "sparse_nonUnique" : "nonUnique" ),
                                uniqueName    = ( sparse ? "sparse_unique" : "unique" );


                            this.lock();
                            this.collection.indexes().then(async indexList=> {

                                // NOTE: Used to use background:true here but it yielded some concurrency errors from Mongo - need to invistigate further.
                                // Using background:false for now.

                                if (indexList.length==1) {
                                    if (nonUniqueLocalKeys.length)
                                        this.collection.createIndex ( indexes, { background:false, sparse: sparse, unique: false, name:nonUniqueName } )
                                        .catch(err=> { console.log ("MongoDB error: "+err); });
                                    if (uniqueLocalKeys.length)
                                        this.collection.createIndex (uniqueIndexes, { background:false, sparse: sparse, unique:true, name:uniqueName } )
                                        .catch(err=> { console.log ("MongoDB error: "+err); });
                                    this.unlock();
                                }
                                else {
                                    var nonUniqueArrIndex = findIndexByName(nonUniqueName,indexList),
                                        uniqueArrIndex    = findIndexByName(uniqueName,indexList);

                                    var nonUniqueDB     = ( nonUniqueArrIndex>-1 ? indexList[nonUniqueArrIndex].key : {} ),
                                        nonUniqueDBKeys = Object.keys (nonUniqueDB),
                                        uniqueDB        = (uniqueArrIndex>-1 ? indexList[uniqueArrIndex].key : {} ),
                                        uniqueDBKeys    = Object.keys (uniqueDB),
                                        collec = this.collection;

                                    var reindex = false, reindexUnique = false;

                                    // Make sure the db index definition is synced with the local one
                                    if (nonUniqueLocalKeys.length) {
                                        nonUniqueLocalKeys.forEach(key=> {
                                            if ( !(key in nonUniqueDB) ) reindex = true;
                                            // If non-unique key in unique index - reindex unique
                                            if ( key in uniqueDB ) reindexUnique = true;
                                        });
                                    }
                                    if (nonUniqueDBKeys.length && !reindex) {
                                        nonUniqueDBKeys.forEach(key=> {
                                            if ( !(key in indexes) ) reindex = true;
                                        });
                                    }

                                    if (uniqueLocalKeys.length && !reindexUnique) {
                                        reindexUnique = 
                                        uniqueLocalKeys.some(key=> {
                                            return (! (key in uniqueDB));
                                        });
                                    }
                                    if (uniqueDBKeys.length && !reindexUnique) {
                                        uniqueDBKeys.forEach(key=> {
                                            if ( !(key in uniqueIndexes) ) reindexUnique = true;
                                        });

                                    }

                                    if (reindex) {
                                        if (nonUniqueArrIndex>-1) {
                                            if (DebugMode) console.log ("dropping non unique index");
                                            await collec.dropIndex(nonUniqueName);
                                        }
                                        
                                        if (nonUniqueLocalKeys.length) {
                                            if (DebugMode) console.log ("Creating non unique index");
                                            collec.createIndex ( indexes, { background:false, sparse: sparse, unique: false, name:nonUniqueName } )
                                            .catch(err=> { console.log ("MongoDB error: "+err); });
                                        }
                                    }
                                    if (reindexUnique) {
                                        if (uniqueArrIndex>-1) {
                                            if (DebugMode) console.log ("dropping unique index");
                                            await collec.dropIndex(uniqueName);
                                        }
                                        if (uniqueLocalKeys.length) {
                                            if (DebugMode) console.log ("Creating unique index");
                                            collec.createIndex (uniqueIndexes, { background:false, sparse: sparse, unique:true, name:uniqueName } )
                                            .catch(err=> { console.log ("MongoDB error: "+err); });
                                        }
                                    }
                            
                                    this.unlock();
                                }
                            });
                        }

                        constructor(collection,indexes,uniqueIndexes,syncInterval) {
                            super();
                            this.setMaxListeners(1000000); // Allow many listeners to the "unlock" event
                            //this.locked = false;
                            this.collectionName = collection;
                            this.insertLocked = false;
                            this.updateLocked = false;
                            this.running = false;
                            this.db = db;
                            this.Mapper = SyncManager.Mapper;
                            this.SYNC_INTERVAL = syncInterval || 1000;
                            this.SYNC_INTERVAL_ID = null;
                            this.PENDING = false;

                            this.BULK = {
                                inserts: {},
                                updates: [],
                                // keys are ids, in each id kes are property names, then value is an array of callback functions
                                updateCallbacks: {}
                            }

                            // Make sure the collection exist - create it if it doesn't. This is new in version 0.1.1
                            if (COLLECTIONS.indexOf(collection)===-1) {
                                this.lock();
                                this.db.createCollection(collection)
                                .then(()=> {
                                    this.collection = this.db.collection(collection);
                                    this.ensureIndexes(indexes, uniqueIndexes, false);
                                    this.unlock();
                                });
                                
                            }
                            else {
                                this.collection = this.db.collection(collection);
                                this.ensureIndexes(indexes, uniqueIndexes, false);
                            }

                            if (DebugMode) console.log (this.collectionName+": Sync manager created");

                        }

                        lock() {
                            this.lockInsert();
                            this.lockUpdate();
                        }
                        unlock() {
                            this.unlockInsert();
                            this.unlockUpdate();
                        }
                        lockInsert() {
                            this.insertLocked = true;
                            if (DebugMode) console.log (this.collectionName+": Sync manager insert locked");

                        }
                        unlockInsert() {
                            this.insertLocked = false;
                            this.emit("insertUnlocked");
                            if (DebugMode) console.log (this.collectionName+": Sync manager insert unlocked");


                        }
                        lockUpdate() {
                            this.updateLocked = true;
                            if (DebugMode) console.log (this.collectionName+": Sync manager update locked");

                        }
                        unlockUpdate() {
                            this.updateLocked = false;
                            this.emit("updateUnlocked");
                            if (DebugMode) console.log (this.collectionName+": Sync manager update unlocked");
                        }

                        clearInserts() {
                            this.BULK.inserts = {};
                        }
                        clearUpdates() {
                            this.BULK.updates = [];
                        }
                        clear() {
                            this.BULK.inserts = {};
                            this.BULK.updates = [];
                            
                        }

                        run() {
                            if (this.running) {
                                console.log (this.collectionName+": SyncManager already running");
                                return;
                            }
                            this.clear();
                            this.PENDING = false;
                            this.SYNC_INTERVAL_ID = setInterval(this.sync.bind(this), this.SYNC_INTERVAL);
                            this.running = true;
                        }
                        stop() {
                            if (this.SYNC_INTERVAL_ID) {
                                clearInterval(this.SYNC_INTERVAL_ID);
                                this.SYNC_INTERVAL_ID = null;
                            }
                            this.running = false;
                        }

                        create(obj) {
                            let insert = this.Mapper.Create(obj);
                            if (!this.insertLocked) {
                                this.BULK.inserts[obj._id] = insert;
                                //if (Object.keys(this.BULK.inserts).length > 100) this.sync.call(this);
                            }
                            else {
                                this.once("insertUnlocked",function() {
                                    this.BULK.inserts[obj._id] = insert;
                                    //if (Object.keys(this.BULK.inserts).length > 100) this.sync.call(this);
                                });
                            }
                        }

                        update(obj,index,property,value,oldValue) {
                            var update = this.Mapper.Update(index,property,value),
                                updateCallback = false;

                            if (!this.updateLocked) {
                                this.BULK.updates.push ( update );
                                //if (this.BULK.updates.operations.length > 100) this.sync.call(this);
                            }
                            else {
                                this.once("updateUnlocked",function() {
                                    this.BULK.updates.push ( update );
                                    //if (this.BULK.updates.operations.length > 100) this.sync.call(this);
                                });
                            }
                        }

                        addUpdateCallback (id, property, value, callback) {
                            if ( !(id in this.BULK.updateCallbacks) )
                                this.BULK.updateCallbacks[id] = {};
                            if ( !(property in this.BULK.updateCallbacks[id]) )
                                this.BULK.updateCallbacks[id][property] = [];
                            if ( !(value in this.BULK.updateCallbacks[id][property]) )
                                this.BULK.updateCallbacks[id][property][value] = [];

                            if (!this.updateLocked) {                                
                                this.BULK.updateCallbacks[id][property][value].push (callback);
                            }
                            else {
                                this.once("updateUnlocked",function() {
                                    this.BULK.updateCallbacks[id][property][value].push (callback);
                                });
                            }
                        }
                        //syncManager.addUpdateCallback(this._id,property,value,callback);

                        handleInserts() {
                            var inserts = this.BULK.inserts,
                                insertDocs = Object.values(inserts);
                            if (!insertDocs.length) return Promise.resolve();

                            return new Promise ( (resolve, reject)=> {
                                console.time("inserts");
                                this.lockInsert();
                                console.log ("Running "+insertDocs.length+" inserts...");
                                this.collection.insertMany(insertDocs, {ordered:false}).then(
                                    res=> {
                                        console.timeEnd("inserts"); 
                                        resolve();
                                        var inserted = Object.values(res.insertedIds);
                                        if (inserted.length !== insertDocs.length) {
                                            console.log ("insertedIds length different than insertDocs length!");
                                            process.exit();
                                        }
                                        // Handle inserts
                                        if (inserted.length) {
                                            var _id;
                                            for (let i=0,len=inserted.length;i<len;i++) {
                                                _id = inserted[i];
                                                if (inserts[_id])
                                                    inserts[_id]._inserted();
                                            }
                                        }
                                    }
                                )
                                .catch (err=> {
                                    console.log ("HAS INSERT ERRORS!");
                                    console.dir (err,{depth:null});
                                    if (err.writeErrors && err.writeErrors.length) {
                                        var we = err.writeErrors, ins;
                                        for (let e of we) {
                                            ins = inserts[e.getOperation()._id];
                                            if (e.code == this.Mapper.Error.DUPLICATE)
                                                ins._isDuplicate();
                                            else
                                                ins._error(e.errmsg);

                                        }
                                    }
                                })
                                .then (function() {
                                    this.clearInserts();
                                    this.unlockInsert();
                                    resolve(); // <- otherwise syncer will be stuck in PENDING forever. Fixed in 20/11/18
                                }.bind(this));
                            });
                        }
                        
                        handleUpdates(updates) {
                            if (!updates.length) return Promise.resolve();
                            return new Promise ( (resolve,reject)=> {
                                //console.time("updates");
                                this.lockUpdate();
                                console.log ("Handling "+updates.length+" updates...");
                                this.collection.bulkWrite(updates).then(
                                    res=> {
                                        //console.timeEnd("updates");
                                        resolve();

                                        // update operation example:
                                        /*
                                        updateOne: {
                                            _id: id 
                                            filter: { 
                                                _id: ObjectID {  _bsontype: 'ObjectID', id: Buffer [ 90, 222, 107, 69, 61, 137, 249, 85, 200, 4, 22, 17 ] }
                                            },
                                            update: { 
                                                '$set': { '_currentLocation.location': 10 } 
                                            }
                                        }
                                        */ 

                                        //var result = res.getRawResponse(), i, len;

                                        //if (result.nModified) {
                                            var id,prop,val,cbs,cb;
                                            for (var op of updates) {
                                                id = op.updateOne._id;
                                                prop = Object.keys(op.updateOne.update.$set)[0],
                                                val = op.updateOne.update.$set[prop];
                                                if (id in this.BULK.updateCallbacks && prop in this.BULK.updateCallbacks[id] && val in this.BULK.updateCallbacks[id][prop]) {
                                                    cbs = this.BULK.updateCallbacks[id][prop][val];
                                                    while (cbs.length) {
                                                        cb = cbs.shift();
                                                        cb();
                                                    }
                                                }
                                                /*
                                                if (op.updateOne.update.$set.hasOwnProperty('_currentLocation.location')) {
                                                    console.log ("set current location:");
                                                    console.dir (op,{depth:null});
                                                }
                                                */
                                            }
                                        //}

                                        // Result of the bulk operations
                                        /*
                                        if (res.hasWriteErrors()) {
                                            console.log ("UPDATE HAS WRITE ERRORS!");
                                            console.log ("operations:", updates.operations.length,"modified:",result.nModified);
                                            console.dir (updates.operations, {depth:null});
                                            console.log ("Errors:",);
                                            console.log (res.getWriteErrors());
                                            process.exit();
                                        }
                                        */
                                    },
                                    err=> {
                                        console.log ("Sync Manager bulk write error: ",err);
                                        resolve();
                                    }

                                )
                                .catch(err=> {
                                        console.log ("Sync Manager bulk write error: ",err);
                                        resolve();
                                })
                                .then(function() {
                                    this.clearUpdates();
                                    this.unlockUpdate();
                                }.bind(this));
                            });
                        }


                        sync() {
                            if (this.PENDING) {
                                console.log ("Sync for "+this.collection+" canceled. Previous sync already pending");
                                console.log (Object.keys(this.BULK.inserts).length+" inserts pending. "+this.BULK.updates.length+" updates pending.");
                                return;
                            }

                            this.PENDING = true;

                            var updates  = [],
                                // eXclusive updates - updates dependant on inserts (should only run after insterts are done)
                                xupdates = [];

                            var u, id;
                            for (var i=0,len=this.BULK.updates.length;i<len;i++) {
                                u = this.BULK.updates[i];
                                id = u.updateOne._id;
                                if (id in this.BULK.inserts) {
                                    xupdates.push (u);
                                }
                                else {
                                    updates.push (u);
                                }
                            }

                            var syncer = this;
                            if (updates.length) {
                                console.log (syncer.collectionName+": running "+updates.length+" updates...");
                            }

                            syncer.handleUpdates (updates);
                            if (Object.keys(this.BULK.inserts).length) {
                                console.log (syncer.collectionName+": running "+Object.keys(this.BULK.inserts).length+" inserts...");
                            }
                            syncer.handleInserts()
                            .then(function() { 
                                if (xupdates.length) {
                                    console.log (syncer.collectionName+": running "+xupdates.length+" xupdates...");
                                }
                                return syncer.handleUpdates(xupdates);
                            })
                            .then(function() {
                                syncer.PENDING = false; 
                            });
                        }
                    }

                    resolve(SyncerClass);
                },
                err=> {
                    console.log ("Error in SyncManager module:",err);
                }

                
            )
            .catch(err=>{
                    console.log ("Error in SyncManager module:",err);

            });
            //});
        });
    }
}

module.exports = SyncManager;
