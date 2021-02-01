# Introduction
This document is a reference, describing all methods and functions available when using Derive.

# Table of Contents
- [Introduction](#introduction)
  * [Modules](#modules)
    + [`Model(options)`](#modeloptions)
  * [`Model` Function](#modelmodel-name-syncinterval)
  * [Static Methods](#static-methods)
    + [`derive`](#derivederivemodel)
    + [`use`](#usemixin)
    + [`collection`](#collection)
    + [`collectionReady`](#collectionready)
    + [`remodel`](#remodeloptions)
    + [`clear`](#clearwhich)
    + [Data Retrieval Methods](#data-retrieval-methods)
      - [`get`](#getwhich)
      - [`getAll`](#getallwhich-sortby-limit0-skip0)
      - [`map`](#mapwhich-index-returnarray-limit0-skip0)
      - [`has`](#haswhich-returndocument)
      - [`count`](#countwhich)
      - [`join`](#joinwhichjoinwithlocalfieldforeignfieldjoinasreturnasmodelfalse)
      - [`joinAll`](#joinallwhich-joinopts-findopts-returnasmodelfalse)
      - [`mainIndex`](#mainindex)
  * [Instance Methods](#instance-methods)
    + [`_inserted`](#_inserted)
    + [`_error`](#_errormsg)
    + [`_isDuplicate`](#_isduplicate)
    + [`changed`](#changedproperty-newvalue-oldvalue)
    + [Assignment with `$callback` Syntax (Update Callbacks)](#assignment-with-callback-syntax-update-callbacks)
    + [`_created`](#_created)
  * [Instance Events (`$_dbEvents`)](#instance-events-_dbevents)
    + [`inserted` Event](#inserted-event)
    + [`updated` Event](#updated-event)
  * [Other data model related options](#other-data-model-related-options)
    + [`$Listen`](#listen)
    + [`$DefaultCriteria`](#defaultcriteria)
    + [`$_BARE`](#_bare)
    + [`$_ModelInstance`](#_modelinstance)

## Modules
### `Model(options)`  
The `Model` module is the only module available in Derive. You call it as a function, passing it an object with options, and it returns a promise that resolves with the 
`Model` *function* - which you can use to define data models.

### Returns
`Model` resolves with the `Model` function which can be used to define data models and receive data classes.

### Example:

```javascript
const derive = require('derivejs');
derive.Model
({
    dbUrl: "mongodb://localhost:27017/",
    dbName: "mydatabase",
})
.then(
    Model=> {
        // `Model` is a function here.
    }
);
```
Or, with `async/await`:

```javascript
// ... Inside an async function
const Model = await require('derivejs').Model({
    dbUrl: "mongodb://localhost:27017/",
    dbName: "mydatabase",
});
```
### These are the available options when calling `Model` to initialize the connection and get access to the `Model` function
* `dbUrl`: the MongoDB server connection url, as a string. Default: "`mongodb://localhost:27017/`".
* `dbName`: the name of the database, as a string. Default: "`deriveDB`".
* `debugMode`: A boolean. If set to true - will display some real-time internal `SyncManager` information - such as when it is locked for operation (before running bulk database operations), and unlocked. Default: `true` (!)
* `defaultMethodsLog`: (new in version 1.x) - when set to `true` - the default class methods for database/data events (`_inserted()`, `_isDuplicate()`, `_error()` and `changed()` will run a relevant `console.log`, see [Database persistence callbacks](#database-persistence-callbacks) for more information about these methods).
* `dbOptions`: You can use this to override the default [MongoDB driver connection options](https://mongodb.github.io/node-mongodb-native/3.5/reference/connecting/connection-settings/). 
Note that these are the options passed by default:
```json
w:1, 
native_parser:true, 
forceServerObjectId:true,
// New in 3.X Mongo engine
useUnifiedTopology: true,
ignoreUndefined: true
```
## `Model(model, name, syncInterval)`
Upon retreiving the `Model` function you can use it to define data models, and get data classes.

### Arguments
#### `model` 
An object literal containing data properties, and optionally instance methods (functions). Each property name can contain special "modifier" characters, which may
be used to define certain aspect of the properties. These are the available modifiers:

* `_` (start) when used as the **first** character of a property, will mark it as an **`index`**. Other than being defined as an index inside MongoDB, an index is also always setabble from the model class **constructor**. 
*Notes*: The order of the indexes defined, matters - as this will also be the order of the arguments in the constructor. Furthermore - the order affects which index is considered as the ["Main Index"](#main-index). Also note, that the property name **does** include the underscore character. 
Example: `_name`;

* `$` (last) When used as the **last** character of an **index** property, that index will be set as a *unique* index (using the same value for unique indexes will yield an error).
Example: `_name$`, will define a *unique index* called `_name` (notice - the `$` char at the end of the property name will be removed, and will **not** be defined as part of the name).

* `ALL_UPPERCASE`, when a property name is defined with all capital letters, it will be marked as **read-only**. If you try to set the value of a read-only property (using the `=` operator) - you will get an error message. Note, that if you also define a read-only property as an *index*, like in the above example - that property will **still** be settable via the constructor arguments (but **not** from anywhere else).

* `$` (start) - Putting the Dollar sign as the **first** character of a property name - will define it as a "**meta**" property (aka a "secret" property). A meta property will **not** be considered as part of the data structure of the model - it and its value will **not** be persisted on the database. If you iterate over the values of the data instance - it will **not** appear (it won't be enumerable). But you may **still** get and set its value locally. This is useful for saving some additional information that you only need locally, and does not require persistence on the database server. These can also be used to reference callback functions, as demonstrated later-on.<br>
There are also, in-fact, four "built-in" meta properties,  two are automatically created for each object:
one is`$_ModelInstance` which always equal to `true`, and is used internally when setting a DeriveJS object value  to an instance of another DeriveJS object (in which case it will be saved as a DBRef object), and the other meta property is [`$DefaultCriteria`](#defaultcriteria) (which is explained later). The third one is [`$Listen`](#listening-for-local-changes), and is not created automatically but can be defined as an array of property names that you want their value-changes to be "listened" to (as explained in "[Listening for changes](#listening-for-local-changes)"). The 4th one is `$_BARE` which contains the "raw" (unproxified) document. Setting the values of the $_BARE object - will **not** affect the database.

* `_` (end) - Using a `_` character as the **last** character in the end of a property name, will add the property **and** its value to the [`$DefaultCriteria`](#defaultcriteria) object, (note, the last `_` will be omitted from the property name). 
If using both last `_` and last `$` (i.e. setting both a unique index and a default-criteria value, make sure the `_` is the **last** character, and the `$` is one before it).

#### `name` 
This is the name of the collection. You can use a singular name, and Derive will make sure the collection name will be in plural form. E.g. if you pass "`Person`" 
as the name - the collection name will be `Persons`.

#### `syncInterval` 
This sets the interval time, in milliseconds between calls to the DB. Every interval the engine sends a queue of data operations to the DB, to be performed.
*Default: 1000ms* (1 second).

### Returns
Calling the Model function returns a "data class" - which is a special proxied JS class, tapped to a DB collection, and containing several static methods related to DB operations, 
and some instance methods related to the instance itself.

### Example
```javascript        
    var Spaceship = Model({
        _name: "",
        _TYPE: "",
        crew: []
    }, "Spaceship");
```

## Static methods
Each Derive data class contains several static methods, to help deal with the data associated with it easily and efficentely.

### `derive(deriveModel)`
This function lets you "extend" an existing data model. The `derive` method returns a new Model Class (*not* a subclass of the original Model class) - that uses the **same** existing 
database synchronization engine (SyncManager), that is already running for the parent model class. It is also possible to "override" properties and values in the derived model.
Note: you may not set an existing index as a unique (by adding a `$`) in a derived model - doing so will have no effect on the index.
You **may** define new indexes - and only objects instances of the derived class will have them. Indexes defined within a derived model - 
are always defined with the `sparse:true` property on the Mongo DB.


#### Arguments
##### `deriveModel`
Passing an object with a model definition (similar to the format of the object passed to the `Model` function) with this argument, 
will define a **new** data class, containing all of the definitions of the current data class of the instance, plus those passed as an argument to the `derive` function.

#### Returns
A new data class, with its data structure defined as the original structure plus the structure passed in `deriveModel`.

#### Example
```javascript
// Spaceship is a Derive model class here
var Battleship = Spaceship.derive ({ 
    _TYPE:"Battleship", 
    weapons: [] 
});
```

### `use(mixin)`
`use` lets you "inject" functionality to any existing model class.

#### Arguments
##### `mixin`
Pass an object literal containing functions. Those functions will be available to use by the data class.

#### Returns
Nothing.

### `collection()`
This function returns the underlying raw Mongo collection, and should rarely be used.

#### Returns
The Mongo collection associated with this data class.

### `collectionReady()`
Whenever a DB operation related to a collection occurs - if that collection doesn't exist yet in the DB, MongoDB implicitly creates it, this can take time (in the area of ~1 second), 
and thus if you run one of the data getter functions (`get`, `getAll`, `map` etc.) - and the collection was not yet created when reaching that point in your code - you will get an error,
and the getter function will fail. To prevent this - the `collectionReady` static method was added to Model classes. Use `collectionReady` in situations where it's not certain that a 
collection exist, and you need to run a getter function on it.

#### Returns
The function returns a Promise that resolves when the collection is created and ready for any operations. 
If the collection already exist the Promise will resolve immediately. 


### `remodel(options)`
This function can be used when you've made changes to the data model, and would like the changes to retroactively affect existing documents in the DB collection.

#### Arguments
##### options
An object of options. Available options are:
* `deep`: [`boolean`] - Setting this to `true` will retroactively add all new properties defined on the model to existing documents in the collection, which don't have those properties,
setting the default value for all of them.
* `renameIndexes`: [`boolean`] - if redefining a property as an index, or removing an index from a property definition (unindexing) - setting `renameIndexes` to true 
will retroactively reflect this in existing documents in the collection; meaning, if a property was unindexed - then all those property names will be renamed to not contain the underscore
in their beginning, and if a property was redefined as an index, all those property name will be renamed to contain an underscore character in their beginning.

#### Returns
A Promise, that resolves if the operation was succesful, or rejects with an error, if there was an error.

### `clear(which)`
Use `clear` to delete documents from the DB.
#### Arguments
###### `which`
Can be a primitive value, representing the value for the main index (first unique index, or first index, or `_id`), to look for, or an object describing a query 
using MongoDB query-format.
#### Returns
A Promise, that resolves if the operation was succesful, or rejects with an error, if there was an error.

### Data retrieval methods

#### `get(which)`
Used to return a single document from a collection.
##### Arguments
###### `which`
Can be a primitive value, representing the value for the main index (first unique index, or first index, or `_id`), to look for, or an object describing a query 
using MongoDB query-format.
##### Returns
A promise that resolves with a single data class (populated with values retrieved from the DB), 
or rejects if no document was found.

#### `getAll(which, sortBy, limit=0, skip=0)`
Similar to `get` only returns an array of data classes
##### Arguments
###### `which`
Can be a primitive value, representing the value for the main index (first unique index, or first index, or `_id`), to look for, or an object describing a query 
using MongoDB query-format.
###### `sortBy`
You can use this to have results sorted by a certain index, pass an object in the format of `{<indexName>: <-1 or 1>}`, where `indexName` is the name of the index property 
you'd like to sort by, and `-1` represents "descending order", and `1` represents "ascending order".
###### `limit`
Pass a number to limit the number of returned results (default: 0, which means unlimited).
###### `skip`
Pass a number to skip this amount of results and start at a certain offset (default: 0, which means unlimited).
##### Returns
A promise that resolves with an array of data objects if succesful, or rejects with an error if failed.

#### `map(which, index, returnArray, limit=0, skip=0)`
Map returns an object, or an array, where keys are values of a selected index, and the values are retrieved data objects.
##### Arguments
###### `which`
Can be a primitive value, representing the value for the main index (first unique index, or first index, or `_id`), to look for, or an object describing a query 
using MongoDB query-format.
###### `index`
The name of the index to map by. Note that it **must** be unique, otherwise some results will override others.
###### `returnArray`
If set to true, will return the results as an array, otherwise will return an object (defaults to an object).
####### `limit`
Pass a number to limit the number of returned results (default: 0, which means unlimited).
###### `skip`
Pass a number to skip this amount of results and start at a certain offset (default: 0, which means unlimited).
##### Returns
A promise that resolves with an object or array of data objects, mapped using the index name passed in `index`, if succesful, or rejects with an error if failed.

#### `has(which, returnDocument)`
Used to check if a certain document/data object exist in the collection
##### Arguments
###### `which`
Can be a primitive value, representing the value for the main index (first unique index, or first index, or `_id`), to look for, or an object describing a query 
using MongoDB query-format.
###### `returnDocument`
If set to `true` will also return the existing document (as a data object) if it exist.
##### Returns
Returns a Promise. If the document does not exist - the promise resolves with `false`, if the document exists, then if `returnDocument` was set to `true` - 
the document will be returned (as a data object), and if `returnDocument` is not `true`, then `true` will be returned.
The Promise rejects with an error in case an error occured or the operation failed.

#### `count(which)`
Returns the number of documents in the collection.
##### Arguments
###### `which`
Can be a primitive value, representing the value for the main index (first unique index, or first index, or `_id`), to look for, or an object describing a query 
using MongoDB query-format.
#### Returns
A Promise that resolves with a number representing the amount of documents in the collection (according to the query criteria), or rejects with an error if the operation failed.

#### `join(which,joinWith,localField,foreignField,joinAs,returnAsModel=false)`
Join lets you combine results from two different collections.
##### Arguments
###### `which`
The criteria (query) for the document to retrieve from the "primary" collection - the collection associated with this data object instance.
###### `joinWith` 
The name of the "secondary" ("foreign") collection (as a string).
###### `localField` 
The name of the field that is equivalent to the foreignField on the secondary collection.
###### `joinAs` 
The name of a property where the "joined" document will be included into. 
###### `returnAsModel` 
If set to `true`, then the function will return an instance of the model (as in when using the get function) - 
you will most likely not want to set it to true, as the model will have "foreign" fields - and once you try setting or changing them - 
it will try to persist it to the db. This function is usually used only for getting "readonly" data, and not data you want to modify or change.
##### Example
Let's say you have a `Posts` collection and a `User` collection, and you want to get the data for a certain post, and join it with the user data of the user who posted it. 
With the following assumptions:
* You have a `Post` model defined, with `_email` as its primary key, and `_authorId` with a string id containing the id of the user who posted it.
* Your `Users` collection documents have a `_userId` field with string ids

```javascript
Post.join("user@email.com","Users","_authorId","_userId","author").then(
    post=> {
        // Now the post object here, will also have an "author" field containing all the data for the user with _authorId/_userId
    }
);
```
##### Returns
A Promise that resolves with a result object, or rejects with an error in case the operation failed.

#### `joinAll(which, joinOpts, findOpts, returnAsModel=false)`
Similar to `join`, only this function can return several data results, in an array.
##### Arguments
###### `joinOpts`
An object with different options regarding the join:
* `joinWith`: the name of the "secondary" ("foreign") collection (as a string).
* `localField`: the name of the field that is equivalent to the foreignField on the secondary collection.
* `foreignField`: the name of the field on the joined collection, equivalent to localField.
* `joinAs` is the name of a property where the "joined" document will be included into.
###### `findOpts`
Lets you specify additional "post-find" options, an object that can contain the following:
* `sortBy`: to return results sorted by a certain index, use Mongo's format for a sort-object, e.g.: `{_date:-1}` - will sort by the `_date` index in a descending order. 
To sort in an ascending order, use `1`nas the value.
* `skip`: lets you skip a number of results,
* `limit`: lets you limit the number of results returned.

###### returnAsModel 
If set to true, then the function will return an instance of the model (as in when using the get function) - 
see notes about this in the documentation for join, and why you should almost never need to set this to true.

#### `mainIndex()`
Returns the data class' [`MainIndex`](https://github.com/yuval-a/derivejs/blob/master/readme.md#mainindex)

## Instance methods
These are methods that are available by default to each data object instance, and can also be overriden by extending the Model class.
These are all "callbacks" related to DB operations.

### `_inserted()`
Called when the equivalent document of this data object was inserted to the collection in the DB.

### `_error(msg)`
Called when the DB returned an error, related to the document equivalent to this data object. 
#### Arguments
##### msg
The error message is passed in `msg`.

### `_isDuplicate()`
Called when an existing duplicate value of the document equivalent to this data object, was set on a unique index.

### Assignment with `$callback` Syntax (Update Callbacks)
With this syntax, instead of directly assigning a value to a property of a data object, you instead assign it an object with two properties:

#### `$value`
The actual value you want to assign.

#### `$callback`
A function that will be called once the property of the equalivent document in the DB is actually updated.

#### Example
```javascript
Feisty.captain = {
    $value: Wort,
    $callback: ()=> {
        console.log ("Wort was updated as the captain of the Feisty");
    }
}
```

The value of `$value` will be assigned to the property, and the function in `$callback` will be called once that property is updated with that value on the DB.

### `changed(property, newValue, oldValue)`
This function will trigger upon changes to certain properties. To register a property to be listened to, put its name on a `$Listen` meta property, in the model defiwhich is the criteria for the document to retrieve from the "primary" ("local" collection),
joinWith is the name of the "secondary" ("foreign") collection (as a string).
localField is the name of the field that is equivalent to the foreignField on the secondary collection.
joinAs is the name of a property where the "joined" document will be included into. returnAsModel - if set to true, then the function will return an instance of the model (as in when using the get function) - you will most liknition, 
containing an array of property names you'd like changes to their value to trigger this function.
#### Arguments
##### `property`
The name of the property that its value changed.
##### `newValue`
The new value of the property.
##### `oldValue`
The pevious, old, value of the property.

### `_created()`
This function is not defined by default on a data object instance - but you can define it yourself - if you do, it will trigger whenever a data object is created (locally), 
and **before** an equivalent document is inserted to the DB.

## Instance Events (`$_dbEvents`)
Each Derive data object has a built-in `$_dbEvents` meta property, which is an `EventEmitter` object, that you can use to listen for DB persistence events and changes, 
by calling the `on` or `once` methods to listen for events in specific instances, and attach handler functions (see [Node Events documentation](https://nodejs.org/api/events.html) for more information about `EventEmitter`).

These are the events available via `$_dbEvents`:
### `inserted` Event
Called once a MongoDB document for this instance was inserted to the DB collection. The callback function receives two arguments:
#### `id` 
The `_id` of the inserted document.
#### `insertedObject` 
This is the same relevant Derive data object instance that was created.
#### Example
```javascript
(new PhotonTorpedos()).$_dbEvents.once("inserted", (id, torpedos)=> {
    // `torpedos` is the PhotonTorpedos instance.
});
```
### `updated` Event 
Called once a MongoDB document's property is updated on the db. The callback function receives three arguments:
#### `id` 
The `_id` of the updated document.
#### `updatedFields`
An object where the keys are updated property names, and the values are the new updated values.
#### `updatedDocument` 
The Derive object instance.
#### Example
```javascript
BoldlyGo.$_dbEvents.on("updated", (id, updatedFields)=> {
    console.log ("BoldlyGo updated properties: ");
    console.dir (updatedFields, {depth:null});
});
```    

## Other data model related options

### `$Listen`
You can define a meta property with this name on any data model defintion, and assign it an array, containing the names of properties you'd like changes to their values to 
trigger the `changed` instance method.

### `$DefaultCriteria`
This is a concept representing a "default query", and can be used to always pass certain query values in addition to the requsted query. You usually don't need to access 
this directly. To add properties and their values to the DefaultCriteria, you put an underscore at the end of their names. This can be used, for example, when defining 
"sub-models", all of which has a constant value to one of their properties (e.g. an entity of an imaginery type "C", will always have its `type` property set to '`C`' - 
and so you could mark that property as DefaultCriteria - and when you retrieve document/data objects from the DB, the `type:'C'` query will automatically be added by default.
(see documentation for more information and clearer examples for when it is used).

### `$_BARE`
A meta property added by default to data object instances, containing a "raw" (unproxied) object.

### `$_ModelInstance`
This meta property is always equal to `true` and is used internaly by the engine to identify Derive objects. **Do not** override this property in your model definitions.
