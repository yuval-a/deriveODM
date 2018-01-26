const MongoClient = require('mongodb').MongoClient,
      ModelMapper = require('./MongoModelMapper'),
      EventEmitter = require('events');

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
                            if (DebugMode) console.log ("Sync manager created");
                            this.locked = false;
                            this.running = false;
                            this.db = db;
                            this.Mapper = SyncManager.Mapper;
                            this.SYNC_INTERVAL = syncInterval || 1000;
                            this.SYNC_INTERVAL_ID = null;
                            this.PENDING = false;

                            this.BULK = {
                                operations: [],
                                inserts: {}, // documents by _id
                                updates: {} // documents by _id
                            }

                            // Make sure the collection exist - create it if it doesn't. This is new in version 0.1.1
                            if (COLLECTIONS.indexOf(collection)===-1) {
                                this.db.createCollection(collection)
                                .then(()=> {
                                    this.collection = this.db.collection(collection);
                                    this.ensureIndexes(indexes, uniqueIndexes, false);
                                });
                                
                            }
                            else {
                                this.collection = this.db.collection(collection);
                                this.ensureIndexes(indexes, uniqueIndexes, false);
                            }
                        }

                        lock() {
                            this.locked = true;
                            if (DebugMode) console.log ("Sync manager locked");
                        }
                        unlock() {
                            this.locked = false;
                            this.emit("unlocked");
                            if (DebugMode) console.log ("Sync manager unlocked");
                        }

                        clear() {
                            this.BULK.operations = [];
                        }

                        run() {
                            if (this.running) {
                                console.log (this.collection+" SyncManager already running");
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
                            if (!this.locked) {
                                this.BULK.operations.push ( insert );
                                if ( !(obj._id in this.BULK.inserts) )
                                    this.BULK.inserts[obj._id] = obj;
                            }
                            else {
                                this.once("unlocked",function() {
                                    this.BULK.operations.push ( insert );
                                    if ( !(obj._id in this.BULK.inserts) )
                                        this.BULK.inserts[obj._id] = obj;
                                    });
                            }
                            
                        }

                        update(obj,index,property,value) {
                            var update = this.Mapper.Update(index,property,value);
                            
                            if (!this.locked) {
                                this.BULK.operations.push ( update );
                                if ( !(obj._id in this.BULK.updates) )
                                    this.BULK.updates[obj._id] = obj;
                            }
                            else {
                                this.once("unlocked",function() {
                                    this.BULK.operations.push ( update );
                                    if ( !(obj._id in this.BULK.updates) )
                                        this.BULK.updates[obj._id] = obj;
                                    });
                            }
                        }

                        handleBulkResult(res) {
                            // Result of the bulk operations
                            var result = res.getRawResponse(), i, len;
                            var inserted = result.insertedIds;

                            // Handle errors
                            if (res.hasWriteErrors()) {
                                var errors = result.writeErrors, err;
                                for (i=0,len=errors.length;i<len;i++) {
                                    err = errors[i];
                                    var errObjId = findByIndexInArray(inserted,err.index)._id;
                                    if (err.code === this.Mapper.Error.DUPLICATE) {
                                        this.BULK.inserts[errObjId]._duplicate();
                                    }
                                    else {
                                        console.log ("Error in bulk operation: ",err.op);
                                        //console.log ("error op: ",err.op);
                                        //if (errObjId in this.BULK.updates) this.BULK.updates[errObjId]._error(err.mess)
                                    }
                                }
                            }

                            // Handle inserts
                            if (result.nInserted) {
                                var _id;
                                for (i=0,len=inserted.length;i<len;i++) {
                                    _id = inserted[i]._id;
                                    if (this.BULK.inserts[_id])
                                        this.BULK.inserts[_id]._created();
                                }
                            }

                            //https://docs.mongodb.com/manual/reference/method/BulkWriteResult/#BulkWriteResult

                            this.clear();
                            this.PENDING = false;
                            this.unlock();

                        }

                        sync() {
                            if (this.PENDING) {
                                console.log ("Sync for "+this.collection+" canceled. Previous sync already pending");
                                return;
                            }

                            if (this.BULK.operations.length===0) return;

                            //console.log ("bulk:");
                            //console.dir (this.BULK.operations,{depth:null});
                            this.lock();
                            this.collection.bulkWrite(this.BULK.operations).then(

                                res=> { this.handleBulkResult(res); },
                                err=> {
                                    console.log ("Sync Manager bulk write error: ",err);
                                    this.unlock();
                                }

                            )
                            .catch(err=> {
                                    console.log ("Sync Manager bulk write error: ",err);
                                    this.unlock();
                            });
                            this.PENDING = true;
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
