// workerData will contain the options object
const { workerData, parentPort } = require('worker_threads');
const SyncManager = require('./SyncManager');

var syncManager = null;
var collectionName = null;

SyncManager.init(workerData).then(
    Syncer=> {
        parentPort.postMessage("init-ready");

        function checkManager() {
            if (!syncManager) {
                parentPort.postMessage({ action: "on-error", message: "Sync Manager instance not created properly!" });
                return false;
            }
            return true;
        }

        parentPort.on('message', message=> {
            
            message = JSON.parse(message);

            switch (message.action) {
                case "new": 
                    syncManager = new Syncer(message.collection, message.indexes, message.uniqueIndexes, message.syncInterval);
                    collectionName = message.collection;
                    break;

                case "create":
                    if (checkManager()) syncManager.create(message.obj);
                    break;

                case "update":
                    if (checkManager()) syncManager.update(message.obj, message.index, message.property, message.value, message.oldValue);
                    break;
                        
                case "unset":
                    if (checkManager()) syncManager.unset(message.obj, message.index, message.property);
                    break;

                case "ensureIndexes":
                    if (checkManager()) syncManager.ensureIndexes(message.indexes, message.uniqueIndexes, message.sparse);
                    break;
            }
        });
        
    },
    error=> {
        console.log ("Error when initializing SyncManager module:");
        console.log (error);
    }
)
.catch(error=> {
    console.log ("Error when initializing SyncManager module:");
    console.log (error);
});

