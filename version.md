# Version Log

## [2.0.0](https://github.com/yuval-a/derivejs/releases/tag/2.0.0)
* Default `SyncManager` sync interval changed to 0, and is now called with `setImmediate`.
* Added support for deleting data object properties using the `delete` keyword, which will trigger an `unset` on the equivalent property of the DB document. 
* Added new assignment with `$callback` syntax for updating properties and attaching callbacks to be called once an update occurs in the DB.
* Now uses ChangeStream (collection event watcher) to detect and trigger DB changes (when available) with fallback to the "manual" detection when using single DB instances.
* Fixed warning when trying to access `_id`
* Deprecated `$onUpdate`.
* Fixed a rare race condition bug.

## [1.6.1](https://github.com/yuval-a/derivejs/releases/tag/1.6.1)
* Switched back to `lodash.deepclone` as others were buggy.
* Added `Connect` alias.

## [1.5.0](https://github.com/yuval-a/derivejs/releases/tag/1.5.0)
* Switched to [`fast-clone`](https://www.npmjs.com/package/fast-clone) package instead of the slower `clone`.
* Refactored main syncing method of `SyncManager` engine, to clone the queues to local variables, as to release them for the next operations sooner an more quickly.
* Added conditions to lock/unlock methods, to not emit uneccesary events.
* Added statc `mainIndex` method to model classes - to allow getting the [`MainIndex`](https://github.com/yuval-a/derivejs/blob/master/readme.md#mainindex)
