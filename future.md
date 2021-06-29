# A (partial) list of planned features for future releases:
- **Multithreaded mode** - have the persistence (SyncManager) engine run in its own separate thread.
- **Journaling** - Similar to Mongo's WiredTiger journaling mechanism - write the last operation-arrays to the file-system before sending them - to enable recovery - 
in case of unexpected server/app shutdowns.
- Consider combining Insert with Update operations on the same array in some situations (need to measure and test for performance gains).
- Micro optimizations in the constructor.
