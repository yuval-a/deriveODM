const { isMainThread } = require('worker_threads');
const { MongoClient } = require('mongodb');
const ModelMapper = require('./MongoModelMapper');
const EventEmitter = require('events');

var SyncManager = {

    dbUrl: "mongodb://localhost:27017/", //deriveDB",
    dbName: "deriveDB",
    debugMode: true,

    dbOptions: {
        native_parser:true, 
        forceServerObjectId:true,
        // New in 3.X Mongo engine
        useUnifiedTopology: true,
        ignoreUndefined: true
    },

    Mapper: ModelMapper,

    mergeOptions: function(options) {
        if (options) {
            if (typeof options === "string") {
                this.dbUrl = options;
            }
            else if (typeof options === "object")
                for (let o in options)
                    this[o] = options[o];
        }
    },
    collection: function(options, collectionName) {
        this.mergeOptions(options);
        return new Promise ((resolve,reject)=> {
            new MongoClient(this.dbUrl, this.dbOptions)
            .connect()
            .then(client=>client.db(this.dbName))
            .then(
                db=> {
                    resolve (db.collection(collectionName));
                }
            );

        });
    },
    init: function(options) {

        this.mergeOptions(options);

        var isChangeStreamSupported;

        return new Promise ( (resolve,reject)=> {

            new MongoClient(this.dbUrl, this.dbOptions)
            .connect()
            .then(client=> {
                const watcher = client.watch();
                // Detect if Cluster / Replica set. ChangeStream is only supported for Replica sets
                isChangeStreamSupported = watcher.topology.s.clusterTime ? true : false;
                return client.db(this.dbName);
            })
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
                            if (!isMainThread) this.collectionName += " WorkerThread";
                            this.insertLocked = false;
                            this.updateLocked = false;
                            this.running = false;
                            this.db = db;
                            this.Mapper = SyncManager.Mapper;
                            this.SYNC_INTERVAL = syncInterval || 0;
                            this.SYNC_INTERVAL_ID = null;
                            this.PENDING = false;

                            this.BULK = {
                                inserts: {},
                                updates: [],
                            }

                            // Make sure the collection exist - create it if it doesn't. This is new in version 0.1.1
                            if (COLLECTIONS.indexOf(collection)===-1) {
                                this.lock();
                                this.db.createCollection(collection)
                                .then(()=> {
                                    this.collection = this.db.collection(collection);
                                    this.ensureIndexes(indexes, uniqueIndexes, false);
                                    // this.collectionWatch();
                                    if (!this.running) this.run();
                                    this.emit('ready');
                                    this.unlock();
                                });
                                
                            }
                            else {
                                this.collection = this.db.collection(collection);
                                this.ensureIndexes(indexes, uniqueIndexes, false);
                                // this.collectionWatch();
                                if (!this.running) this.run();
                            }

                            if (DebugMode) this.log ("Sync Manager created");

                        }

                        // For debugging - auto prefixes collection name to message
                        log(message) {
                            console.log (this.collectionName + ": " + message);
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
                            if (this.insertLocked) return;
                            this.insertLocked = true;
                            if (DebugMode) this.log ("Sync Manager insert locked");
                        }
                        unlockInsert() {
                            if (!this.insertLocked) return;
                            this.insertLocked = false;
                            this.emit("insertUnlocked");
                            if (DebugMode) this.log ("Sync Manager insert unlocked");
                        }
                        lockUpdate() {
                            if (this.updateLocked) return;
                            this.updateLocked = true;
                            if (DebugMode) this.log ("Sync Manager update locked");
                        }
                        unlockUpdate() {
                            if (!this.updateLocked) return;
                            this.updateLocked = false;
                            this.emit("updateUnlocked");
                            if (DebugMode) this.log ("Sync Manager update unlocked");
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
                                this.log ("Tried to run SyncManager, but already running");
                                return;
                            }
                            this.clear();
                            this.PENDING = false;

                            // Start syncing intervals
                            this.SYNC_INTERVAL_ID = setInterval(()=> {
                                setImmediate(this.sync.bind(this)); 
                            }, this.SYNC_INTERVAL);

                            // this.SYNC_INTERVAL_ID = setInterval(this.sync.bind(this), this.SYNC_INTERVAL);
                                
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
                            }
                            else {
                                this.once("insertUnlocked",function() {
                                    this.BULK.inserts[obj._id] = insert;
                                });
                            }
                        }

                        // callback is a function to call once the update occurs
                        update(obj, index, property, value, oldValue, callback = false) {
                            let update = this.Mapper.Update(index, property, value);
                            update.$callback = callback;
                            if (!this.updateLocked) {   
                                this.BULK.updates.push ( update );
                            }
                            else {
                                this.once("updateUnlocked",function() {
                                    this.BULK.updates.push ( update );
                                });
                            }
                        }

                        unset(obj, index, property) {
                            var update = this.Mapper.Unset(index, property);

                            if (!this.updateLocked) {
                                this.BULK.updates.push ( update );
                            }
                            else {
                                this.once("updateUnlocked",function() {
                                    this.BULK.updates.push ( update );
                                });
                            }
                        }

                        handleInserts() {
                            var inserts = this.BULK.inserts,
                                insertDocs = Object.values(inserts);
                            if (!insertDocs.length) return Promise.resolve();

                            return new Promise ( (resolve, reject)=> {
                                this.lockInsert();
                                if (DebugMode) this.log ("Running "+insertDocs.length+" inserts...");
                                this.collection.insertMany(insertDocs, {ordered:false})
                                .catch (err=> {
                                    // Mongodb 3.x skips the then in-case of error - but still saves inserted ids on a "result" object
                                    //console.dir (err, {depth: null});
                                    let result = err.result;
                                    if (!result) {
                                        this.log (err.message);
                                        return;
                                    }
                                    let op;
                                    if (result.hasWriteErrors()) {
                                        var writeErrors = result.getWriteErrors(), ins;
                                        // console.log ("GOT WRITE ERRORS: ");
                                        // console.dir( writeErrors, { depth: null} );
                                        for (let we of writeErrors) {
                                            op = we.getOperation();
                                            ins = inserts[op._id];
                                            delete inserts[op._id];
                                            if (we.code == this.Mapper.Error.DUPLICATE)
                                                ins._isDuplicate();
                                            else
                                                ins._error(we.errmsg);
                                        }
                                    }
                                })
                                .then (function() {
                                    insertDocs.forEach(doc=> {
                                        doc.$_dbEvents.emit("inserted", doc._id, doc);
                                        if (doc._inserted) doc._inserted.call(doc);
                                    });
                                    this.clearInserts();
                                    this.unlockInsert();
                                    resolve(); // <- otherwise syncer will be stuck in PENDING forever. Fixed in 20/11/18
                                }.bind(this));
                            });
                        }
                        
                        handleUpdates(updates) {
                            if (!updates.length) return Promise.resolve();
                            return new Promise ( (resolve, reject)=> {
                                //console.time("updates");
                                this.lockUpdate();
                                if (DebugMode) this.log ("Handling "+updates.length+" updates...");
                                this.collection.bulkWrite(updates).then(
                                    _=> {
                                        for (let op of updates) {
                                            if (op.$callback) op.$callback();
                                        }
                                    },
                                    err=> {
                                        this.log ("Sync Manager bulk write error: ");
                                        console.log (err);
                                    }

                                )
                                .catch(err=> {
                                        this.log ("Sync Manager bulk write error: ");
                                        console.log (err);
                                })
                                .then(function() {
                                    this.clearUpdates();
                                    this.unlockUpdate();
                                    resolve();
                                }.bind(this));
                            });
                        }

                        sortUpdates() {
                            // THIS LOCK WAS ADDED TO FIX A RACE CONDITION! Where a new update was added to bulk, JUST BEFORE the sorting happens (the sorting rely on BULK.updates)
                            this.lockUpdate();
                            return new Promise ((resolve,reject)=> {
                                var updates = [], xupdates = [];
                                var u, id;
                                for (let i=0,len=this.BULK.updates.length;i<len;i++) {
                                    u = this.BULK.updates[i];
                                    id = u.updateOne._id;
                                    if (id in this.BULK.inserts) {
                                        xupdates.push (u);
                                    }
                                    else {
                                        updates.push (u);
                                    }
                                }
                                resolve([updates, xupdates]);
                            });

                        }

                        hasOperations() {
                            return (
                                Object.keys(this.BULK.inserts).length ||
                                this.BULK.updates.length
                            )
                        }

                        async sync() {
                            // If no operations in queue - set PENDING to false
                            if (!this.hasOperations()) {
                                // this.log ("NO OPERATIONS TO SYNC");
                                this.PENDING = false;
                                return;
                            }

                            if (this.PENDING) {
                                if (DebugMode) {
                                    // this.log ("Sync for "+this.collectionName+" postponed. Previous sync already pending");
                                    // this.log (Object.keys(this.BULK.inserts).length+" inserts pending. "+this.BULK.updates.length+" updates pending.");
                                }
                                return;
                            }

                            this.PENDING = true;
                            const syncer = this;

                            // If no updates or no inserts - the handle function simply resolves
                            let handleUpdates = ()=> Promise.resolve();
                            let handleInserts = ()=> Promise.resolve();
                            let updates = false;
                            // eXclusive updates - updates dependant on inserts (should only run after insterts are done)
                            let xupdates = false;

                            if (this.BULK.updates.length) {

                                [ updates, xupdates ] = await this.sortUpdates();
                                // A function that returns a promise which resolves once the handleUpdates promise is resolved
                                handleUpdates = 
                                ()=> new Promise (resolve=> { syncer.handleUpdates(updates).then(()=> { resolve(); }) } );
                            }

                            if (Object.keys(this.BULK.inserts).length) {
                                // A function that returns a promise which resolves once the handleInserts, and optionaly the handleUpdates with xupdates promise(s) is/are resolved
                                handleInserts =
                                ()=> new Promise(resolve=> {
                                    syncer.handleInserts()
                                    .then(()=> { 
                                        if (xupdates) 
                                            syncer.handleUpdates(xupdates).then(()=> { resolve(); } );
                                        else resolve();
                                    })
                                });
                            }

                            await Promise.all([ handleUpdates(), handleInserts() ]);
                            syncer.PENDING = false;
                            // Syncer is free for the next sync
                            this.emit('syncerFree');
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
