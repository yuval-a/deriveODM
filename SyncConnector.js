const SyncManager  = require('./SyncManager');
const EventEmitter = require('events');
const { ObjectID } = require('mongodb');

module.exports = (options)=> {

    return new Promise( async (resolve, reject)=> {

        // Multithread mode is UNSTABLE yet. Currently always turn it off.
        
        options.multiThreaded = false;

        // Caller will interact with SyncManager via SyncWorker
        if (options.multiThreaded) {
            const { Worker } = require('worker_threads');
            const SyncWorker = new Worker(__dirname + '/SyncWorker.js', { workerData: options });

            SyncWorker.on("message", async message=> {
                if (message == "init-ready") { 

                    class SyncerClass extends EventEmitter {

                        getCollection(collectionName) {
                            return new Promise(async resolve=> {
                                this.collection = await SyncManager.collection(options, collectionName);
                                resolve();
                            });
                        }

                        constructor(collection, indexes, uniqueIndexes, syncInterval) {
                            super();

                            this.collectionName = collection;
                            this.worker = SyncWorker;

                            this.worker.postMessage(
                                JSON.stringify({
                                    action: "new",
                                    collection, indexes, uniqueIndexes, syncInterval
                                })
                            );

                            this.worker.on("message", message=> {
                                switch (message.action) {
                                    /*
                                    case "on-inserted":
                                        this.emit("inserted", message.id, message.fullDocument);
                                        break;

                                    case "on-updated":
                                        this.emit("updated", message.id, message.updatedFields, message.fullDocument);
                                        break;

                                    */

                                    case "on-error":
                                        console.log ("SyncWorker error: " + message.message);
                                        break;
                                }
                            });
                        }

                        create(obj) {
                            // We need to create _id here -- otherwise, an update maybe called before _id was assigned
                            obj._id = new ObjectID();
                            this.worker.postMessage(
                                JSON.stringify({
                                    action: "create",
                                    obj
                                })
                            );
                        }
                        update(obj, index, property, value, oldValue) {
                            this.worker.postMessage(
                                JSON.stringify({
                                    action: "update",
                                    obj: JSON.stringify(obj),
                                    index: JSON.stringify(index),
                                    property,
                                    value: JSON.stringify(value),
                                    oldValue: JSON.stringify(oldValue)
                                })
                            );
                        }
                        unset(obj, index, property) {
                            this.worker.postMessage(
                                JSON.stringify({
                                    action: "unset",
                                    obj, index, property
                                })
                            );
                        }

                        ensureIndexes(indexes, uniqueIndexes, sparse) {
                            this.worker.postMessage(
                                JSON.stringify({
                                    action: "ensureIndexes",
                                    indexes, uniqueIndexes, sparse
                                })
                            );
                        }
                    }
                    
                    // Resolves from getCollection method, since it can be called later
                    resolve (SyncerClass);
                }
            });
        }
        else {
            // Caller interacts directly with SyncManager class.
            // A single-threaded Syncer class
            const Syncer = await SyncManager.init(options);
            resolve(Syncer);
        }
    });
}