# Version Log
## 1.5.0
* Switched to [`fast-clone`](https://www.npmjs.com/package/fast-clone) package instead of the slower `clone`.
* Refactored main syncing method of `SyncManager` engine, to clone the queues to local variables, as to release them for the next operations sooner an more quickly.
* Added conditions to lock/unlock methods, to not emit uneccesary events.
* Added statc `mainIndex` method to model classes - to allow getting the [`MainIndex`](https://github.com/yuval-a/derivejs/blob/master/readme.md#mainindex)
