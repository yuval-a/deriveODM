
## Introduction

**DeriveJS** lets you manipulate and create Javascript data objects, while **automatically** and **transparently** persisting and updating them on a database (such as MongoDB), in the background, without any additional hassle or code.

It wraps your data classes and objects with [Javascript Proxies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy), "tapping-in" to native operations such as creating instances (using the normal `new` operator), and updating property values (using the normal assignment operator `=`), and then handling passing database calls to the database in the background, while leveraging MongoDB's bulk operations capabilities in a smart way, to save unnecessary calls to the db engine,
and running bulk operations in fixed (settable) intervals. The background engine is mostly handled transparently by a module called `SyncManager`.

### The rationale behind DeriveJS, using an analogy
If you are familiar with a front-end UI framework such as ReactJS, you know that whenever a change is made to the `state` object - React will automatically know to issue a re-render of the component - this is called a "pull" methodology, where as in other similar frameworks, you might need to explicitly call a `render()` method (this is a "push" methodology, in that context).
In a similar analogy to the way React works - when using Derive - you are **not required** to call an explicit `save()` method to have your data be saved and persisted on a db - it's enough that you make some change to an exisiting data object, or create a new one - and Derive will already know to handle that data's persistence.

## How to use
It only takes a few easy steps:

##### Define a data model:
```javascript
    var User = Model({
        _email$: "",
        _name: "",
        age: null,
        password: null,
        setPassword(pass) {
            // hash the plain-text password ("hashit" is just an example function for your preffered hashing function)
            var passwordHash = hashit(pass);
            this.password = passwordHash;
        }
    },"User");
```
The first time you define it, a `Users` collection is defined on the database, with an `_email` unique index and a `_name` index (you can also alter the properties, change indexes later).

##### Create an instance
```javascript
    var user = new User ("someemail@mail.com","Someone Somebody");
```
There will now be a new document in the `Users` collection, having "`someemail@mail.com`" as the `_email` and "`Someone Somebody`" as the `_name`.

##### Manipulate properties 
```javascript
    user.age = 30;
```

The document will now have the value `30` set to its `age` property.

##### Call instance functions:
```javascript
    user.setPassword("plaintextpassword");
```

And so on...

With `DeriveJS` you can create and manipulate a large amount of data objects, and know that they will be persisted in the database, efficiently and in a short time.

Although the methodology behind the framework is mostly that of "send and forget" regarding data persistence - DeriveJS also exposes [callback functions](#Built-in-methods:-callbacks-and-hooks) that allows getting notified exactly when specific objects
are actually saved on the database, or exactly when specific properties have been actually updated, for the occasions when you need to know it for certain operations.


## Getting Started

(**Note**: Version 1.x has been updated to support MongoDB Node driver version 3.x. Although it has been tested - if you encounter any issues when upgrading - please report them in the issues tab - in the Git repository)

Install via [npm](https://www.npmjs.com/):<br>
`npm install derivejs` <br>
or clone the [git repository](https://github.com/yuval-a/derivejs).

You should also setup or have access to a [MongoDB](https://www.mongodb.com/) server, and have it running.

To get started, require DeriveJS, and then call the `Model` module. The module is a `Promise` that resolves with a `Model` function. By the time the Promise is resolved, the module has finished its initializations, and is connected to the MongoDB server. When you call the module, you should pass an `options` argument to it.
The `options` can contain 3 key:value arguments:

* `dbUrl`: the MongoDB server connection url, as a string. Default: "`mongodb://localhost:27017/`".
* `dbName`: the name of the database, as a string. Default: "`deriveDB`".
* `debugMode`: A boolean. If set to true - will display some real-time internal `SyncManager` information - such as when it is locked for operation (before running bulk database operations), and unlocked. Default: `true` (!)
* `defaultMethodsLog`: (new in version 1.x) - when set to `true` - the default class methods for database/data events (`_inserted()`, `_isDuplicate()`, `_error()` and `changed()` will run a relevant `console.log`, see [Database persistence callbacks](#database-persistence callbacks) for more information about these methods).

Here is an example of how to initialize the module:

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
### Defining a Data Model
Once inside the resolved promise, you can use the `Model` function to define a "Data Model", by passing an object literal as an argument, describing the data properties and their default values (as well as some instance methods, when needed). The `Model` function returns a **`class`** "representing" that data model, and its functionality. (as mentioned, that class is a special "proxied" class that comes with some
built-in stuff in it, to handle database persistence, and offer some static and default instance methods which will be described below).

Let's create a data model to represent a "spaceship":

```javascript        
    var Spaceship = Model({
        _name: "",
        _TYPE: "",
        crew: []
    }, "Spaceship");
```

Now `Spaceship` is a `class` you can create new object instances of.
The second argument for the `Model` function is a name, that will be used for both the class name, and the collection name (where an `s` will be added to, to signify "plural" form; So the collection name will be `Spaceships` in this case). There is an additional optional argument, that can set the "sync interval" duration, the amount of time between each interval where the SyncManager class instance runs the database bulk operations stacked since the last sync. The default is 1000ms (1 second).
(The Model function also have two additional arguments `_syncer`, and `_proxy`, used internally and that shouldn't be used).

Notice that some properties were defined with an underscore, and some are uppercase. This is **intentional**, and meaningful. These are called "*Modifiers*" and are explained in the next section.

## Going deeper

### Modifiers
You can use some special characters in the property names (called "*Modifiers*"), that will define certain characteristics of those properties:

* `_` (start) when used as the **first** character of a property, will mark it as an **`index`**. Other than being defined as an index inside MongoDB, an index is also always setabble from the model class **constructor**. 
*Notes*: The order of the indexes defined, matters - as this will also be the order of the arguments in the constructor. Furthermore - the order affects which index is considered as the ["Main Index"](#main-index). Also note, that the property name **does** include the underscore character. 
Example: `_name`;

* `$` (last) When used as the **last** character of an **index** property, that index will be set as a *unique* index (using the same value for unique indexes will yield an error).
Example: `_name$`, will define a *unique index* called `_name` (notice - the `$` char at the end of the property name will be removed, and will **not** be defined as part of the name).

* `ALL_UPPERCASE`, when a property name is defined with all capital letters, it will be marked as **read-only**. If you try to set the value of a read-only property (using the `=` operator) - you will get an error message. Note, that if you also define a read-only property as an *index*, like in the above example - that property will **still** be settable via the constructor arguments (but **not** from anywhere else).

* `$` (start) - Putting the Dollar sign as the **first** character of a property name - will define it as a "**meta**" property (aka a "secret" property). A meta property will **not** be considered as part of the data structure of the model - it and its value will **not** be persisted on the database. If you iterate over the values of the data instance - it will **not** appear (it won't be enumerable). But you may **still** get and set its value locally. This is useful for saving some additional information that you only need locally, and does not require persistence on the database server. These can also be used to reference callback functions, as demonstrated later-on.<br>
There are also, in-fact, three "built-in" meta properties,  two are automatically created for each object:
one is`$_ModelInstance` which always equal to `true`, and is used internally when setting a DeriveJS object value  to an instance of another DeriveJS object (in which case it will be saved as a DBRef object), and the other meta property is [`$DefaultCriteria`](#defaultcriteria) (which is explained later). The third one is [`$Listen`](#listening-for-local-changes), and is not created automatically but can be defined as an array of property names that you want their value-changes to be "listened" to (as explained in "[Listening for changes](#listening-for-local-changes)").

* `_` (end) - Using a `_` character as the **last** character in the end of a property name, will add the property **and** its value to the [`$DefaultCriteria`](#defaultcriteria) object, (note, the last `_` will be omitted from the property name). 
If using both last `_` and last `$` (i.e. setting both a unique index and a default-criteria value, make sure the `_` is the **last** character, and the `$` is one before it).

Having obtained our data class, we can create object instances of it:

```javascript 
var ship = new Spaceship('The Beyond'); 
```
Each new instance - will have an identical data record (a "document") in a MongoDB database, in a `Spaceships` collection,  which will always be synced with the changes you make to the "local" object. Once you create a new instance, that instance will also have an auto-generated `_id` value (of type [ObjectID](https://docs.mongodb.com/manual/reference/method/ObjectId/)) associated with it.
After a while you should see a message on the console: `The Beyond inserted`, that message comes from an instance method that all model instances has by default,
and can be overridden by subclasses:
```javascript
_inserted() {
    console.log (this[MainIndex]+" inserted");
}
```
([`MainIndex`](#mainindex) is an internal variable that holds the "primary" index of the collection, in this case `_name`).
The method is called as soon as the data object is persisted on the MongoDB server.

Notice how we passed a `_name` for the new instance via the first argument of the constructor. We can do that, since we defined it as an index. We can also pass a value
for the `_TYPE` index as the second argument. Let's create a different ship, and define it as "TYPE A":
```javascript 
var shipA = new Spaceship('The Beyonder','A');
```

If we now run the Mongo console, and run a "find all" query on the `Spaceships` collection (`db.Spaceships.find({})`, we will see our two `Spaceship` data objects saved on the server:

```
{ "_id" : ObjectId("5a063879cc5cac16b82d05f0"), "_name" : "The Beyond", "_TYPE" : "", "crew" : [ ] }
{ "_id" : ObjectId("5a063879cc5cac16b82d05f1"), "_name" : "The Beyonder", "_TYPE" : "A", "crew" : [ ] }
```

Your `_id` values will vary, of-course.

### Built-in methods: callbacks and hooks

**NEW VERSION UPDATE:**  some of these method names have been **changed** from previous versions:
* `_created()` was changed to `_inserted()`
* `_duplicate()` was changed to `_isDuplicate()`
* `$update()` was changed to `$onUpdate()`
* added support for `_created()` method which, if defined on a model, gets called once an object instance is created, **before** it is persisted in the db.
Every instance of an object has some built-in "callback" functions that are called when certain database-persistence related events occur in regards to that object, and each data class also have some "static" callback methods, so you can use them in situations when you need to follow certain events, like having an object inserted to the database collection, having a certain property updated, and more.
One possible use-case for `created()` is, for example, if you need to set a value for a **unique index** property, before it is inserted into the db; if you won't
set it, and a default value will be used for it when inserting, then a "duplicate value" error could be triggered.

#### new Model instance lifecycle
When creating a new model object instance - first the, "internal" constructor of the model class is called. 
This constructor is defined within the `Model` module, and is the same for **all** model classes (having different initialization properties, of-course). First, if the constructor was called as a result of retrieving a data object (document) from the database - the object values will be populated accordingly. Then, this constructor function is basically in-charge of the following things, in this order:

1. "Proxifiying" all (non-meta) property values of the object (so they can all be automatically persisted to the db upon change).
2. Starting (running) the associated `SyncManager` class (if it's not already running) - which will "gather" db-related operations and bulk-run them in fixed intervals for the associated db collection).
3. If this is a **new** data object - create a **local** data (MongoDB) document first - this is the point where the `_created` function of the data class is called (if defined) - and is the "last chance" to make new changes before the data object will be persisted on the db (of-course, you can also update any of its properties as you like later-on, and they'll be persisted as well).
4. The `SyncManager` puts an `insert` operation in the queue of the next bulk db operations to be run.

It's important to note, that if you extend a Model class, and define both a constructor on the extended class **and** a `_created` method - 
the `_created` method will be called **before** the extended class constructor finishes - as it needs to call the base class ("super") constructor first, which will call `_created` if defined.
So, for example with the following:

```javascript
    var Spaceship = Model({
        _name: "",
    }, "Spaceship");

    class Ship extends Spaceship {
        constructor (_name) {
            super(_name);
            console.log (_name+" called from constructor");
        }
        _created() {
            console.log (this._name+" called from _created");
        }
    }

    var ship = new Ship("a new ship");
```
You will first see the `console.log` message from the `_created` and *then* the message from the (extended class) constructor.
After a short while, when the document is inserted on the db - you will see messages logged from the `_inserted` method (if a `console.log` was defined there and `debugMode` was defined with `true` when initializing the `Model` module).

#### Database persistence callbacks

* `_inserted()`

If you need to know exactly when an object is actually persisted in the database every instance has a built-in instance method: `_inserted()` which is called as soon as it's inserted in the DB.
You can override that method -- either by extending a class - or defining the method directly inside the model definition -- and put some "post-persistence" code there, if you need.

```javascript
class Ship extends Spaceship {
    _inserted() {
        console.log (this._name+" created, with id: "+this._id); 
    }
}
var ship = new Ship("The Created");
```
will yield:
`The Created created, with id: 5a063f842ef67924f4e0f9bb` (with a different id of-course).

If you want to implement specific callbacks for **specific instances**, you have several ways to achieve this:

You can define a meta property on the model, to hold a callback function.

```javascript
var Spaceship = Model({
    _name: "",
    _TYPE: "",
    crew: [],

    $createdCallback: undefined

}, "Spaceship");
```

Then extend the class, and allow passing a callback function via the constructor. Call the callback from the overridden `_inserted` function:

```javascript
class Ship extends Spaceship {
    constructor(_name, _TYPE, callback) {
        super(_name, _TYPE);
        this.$createdCallback = callback;
    }
    _inserted() {
        this.$createdCallback.call(this);
    }
}

var ship = new Ship("shipA","", function() {
    console.log ("shipA created!");
});
```

Note how when overriding a constructor in a child class - you need to specify the indexes as arguments before adding new ones, and of-course, you need to call the parent constructor via `super`.

Another option is to use an [`EventEmitter`](https://nodejs.org/api/events.html) as a meta value:

```javascript

const EventEmitter = require("events");
var Spaceship = Model({
    _name: "",
    _TYPE: "",
    crew: [],

    $events:EventEmitter

},"Spaceship");

class EventfulShip extends Spaceship {
    constructor(_name,_TYPE) {
        super(_name,_TYPE);
        this.$events = new EventEmitter();
    }
    _inserted() {
        this.$events.emit("created");
    }
}

var ship = new EventfulShip("ShipB");
ship.$events.on("created",function() {
    console.log ("ship b created!");
});
```

* `_isDuplicate()`:  Called when the MongoDB server yields a "duplicate key value" error, and contains by default:
`console.log (this[MainIndex]+" has a duplicate key value!");`

* `_error(msg)` : Called whenever there is a data-related error for this object, and contains by default:
`console.log ("Error in "+this[MainIndex]+": "+msg);`


#### Listening for local changes
The fourth built-in method can be used when you want to listen for value-changes on certain properties of your object,
(**Note**: this will trigger on *local* changes to the properties, regardless to their state in the equavilent documents in the database collection)

* `changed(property, newValue, oldValue)`

To register a property for the listener, put its name (as a string) inside an array defined as the `$Listen` meta-property (e.g. `$Listen: [ "property" ,"otherproperty", "objectprop.prop"]`.
The `changed` method contains this code by default:
`console.log (this[MainIndex]+":",property,"changed from",oldValue,"to",newValue);`

#### Listening for updates on the database
**Note**: `$UpdateListen` from previous versions is currently *deprecated*.

Each Model class also has an `$onUpdate()` method, that you can use if you need to know exactly when
a certain property has been **updated and saved on the database**. The `$onUpdate()` method is used as follows:

```javascript 
$onUpdate (property, value, callback)
```
`callback` is a function that will be executed the next time that `property` is set to `value`.
Note that `property` is a **string**. If the property is nested, simply use its nested notation as a string, e.g.
`someprop.anotherprop.prop`.
Note also that the callback will be called only **once**, as soon as the property is set to `value` after `$onUpdate()` was called.
Also note, that `$onUpdate` **doesn't** actually set the value on `property` - you have to do it yourself explicitly; so, if you have some instance `dataobj`, and you want to run some code as soon as the property `prop` on it is updated on the db to, let's say `25`:

```javascript
   dataobj.$onUpdate ("prop",25, function() {
        // some code here...
   });
   // Actually update the value. This will set it on the local object, and soon after - it will also be updated on the db,
   // and then the callback in $onUpdate above will be called
   dataobj.prop = 25;
```

### Unique indexes
Now, we decide that we want the `_name` property index to be unique:

```javascript
var Spaceship = Model({
    _name$: "",
    _TYPE: "",
    crew: [],
},"Spaceship");
```

Once the engine modifies the `_name` index to make it unique, if there are records with duplicate `_name` values - Mongo will throw an **error**, and the unique index will **not** be defined. You will need to take care of the duplicates yourself for it to successfully be defined. You can either issue a relevant `.remove` command from the mongo console, or you can also use the static `clear()` method on the `Spaceship` class. The `clear` method can accept a "find query" filter as an argument (e.g. `{_name:"The Beyond"}`). So, for example if you have several ships named "`The Beyond`" and you want to define a unique constraint on `_name` and create a new, single `"The Beyond"` ship, then you can use:

```javascript
    await Model({},"Spaceship").clear({_name:"The Beyond"});
    var Spaceship = Model({
        _name$: "",
        _TYPE: "",
        crew: [],
    }, "Spaceship");
        
    var ship = new Spaceship ("The Beyond");
```
The first line is just for getting a reference to the `Spaceships` collection, to call `clear` to remove all "`The Beyond`" ships, then we can define the model with the new constraint, and create a new unique ship.

At this point we have the `_name` index defined as a unique index -- there can't be more than one object with the same `_name` value. Let's see what happens when we
try to create two Spaceships with the same name:
```javascript
    var ship1 = new Spaceship ("The Boldly Go","A");
    var ship2 = new Spaceship ("The Boldly Go","B");
```

We will get a message on the console:
`The Boldly Go has a duplicate key value!`

One of the records was successfully inserted to the database, the other was detected as having a duplicate `_name` and was rejected. The message is coming
from the `_isDuplicate()` instance method, that all Model instances have. Its body is defined with:

```javascript
_isDuplicate() {
    console.log (this[mainIndex]+" has a duplicate key value!");
}
```

You may override this method in your class extension or model definition, and define your own logic to take care of duplicates. If we look inside the database, we'll see that only the ship with `_TYPE` `A` is saved on the database.

It is possible to remove a unique constraint from an index - simply define it without the `$` sign - and the engine will know how to redefine it.
You may also "disable" an index - redefine it as a "normal" property - to do so, just define it without the leading `_`. 
Suppose we want to unindex the `_TYPE` property, we can define our model as:

```javascript
    var Spaceship = Model({
        _name$: "",
        TYPE: "",
        crew: [],
    }, "Spaceship" );
```

**However** - any past documents in our database collection, will *still* have the old `_TYPE` property in them. 

### The `remodel` method
If you'd like to retroactively rename all the old `_TYPE` properties in existing documents to `TYPE`, you can use the static `remodel()` method. That function gets an object of options, as an argument - 
which you can use to switch on certain types of the method's operations. Currently there are two:

```javascript
deep: true,
renameIndexes: true
```

With `renameIndexes:true` - the method will rename properties in documents in the collection that starts with a `_` and are defined in the model without it. Similarly it will rename properties **without** a leading `_` that appear in the model definition with it (for situations where you decide to define an index for a non-index property).
So, to rename all `_TYPE` properties to `TYPE` in our collection, we could have used:
`Spaceship.remodel( { renameIndexes: true } );`

The `deep` operation allows you to retroactively define new properties on existing documents on a collection. If you add a new property to your model definition (for example, you add a `captain` property with a default value of an empty string) - then older documents won't have it (which may or may not be what you want) - 
using `deep:true` will add the new property with its default value to **all** existing documents in the collection.

To read more about indexes and how they are managed in DeriveJS -- see "[Indexes and how they are handled in the Mongo server](#indexes-and-how-they-are-handled-in-the-Mongo-server)".

You will probably want to have `remodel` called only once after you make changes to your models, therefore it might be a good idea to call it in response to a certain command-line argument when running your Node app.
For example:

```javascript
// process.argv is an array, where the first item contains 'node', the second item contains the script file name, and the rest of the items are command-line arguments
if (process.argv[2] == "--remodel") {
    Spaceship.remodel({ deep:true, renameIndexes: true});
}
```


## Going further - extending and deriving models

Let's define a "sub-type" of `Spaceship`, we'll call it a `Battleship`, and we'll also add a property to hold its weapons.
If we do it like this (note, this is the WRONG way):


```javascript
class Battleship extends Spaceship {
    constructor (_name,_TYPE) {
        super(_name,_TYPE);
            this.weapons = [];
        }
    }
}
```
And then create a new instance:
```javascript
var bship = new Battleship("The Destroyer");
```

Then we will get an error message on the console:
`Error in The Destroyer: Trying to set unknown property: weapons (property value is left unchanged).`
Since `weapons` is not a known property of the model, as it wasn't defined as part of its structure.
That error message, by the way, is displayed via the `_error(msg)` instance method that all instances have, and is called whenever there is an error
**related to that instance**.
The new object **will** be inserted into the database, it just won't have any `weapons` property defined on it.

To add new properties to an already existing model - you should use the static `derive(modelExtension)` method on the Model class. That method
use an object defining the *additional* properties and values that should be added to the parent-model (the "super-model" :) ), 

So, the more "right" way to extend the `Spaceship` to a `Battleship` in this case is
(and let's also set the `_TYPE` to "`Battleship`" as well):

```javascript
class Battleship extends Spaceship
.derive ( { weapons: [] } ) 
{
    constructor (_name) {
        super(_name,"Battleship");
    }
}

var bship = new Battleship("The Destroyer");
```

The `derive` method returns a new Model Class (*not* a subclass of the original Model class) - that uses the **same** existing database synchronization engine (SyncManager), that is already running for the parent model class (So the `Battleship` class will use the SyncManager of the `Spaceship` class, which is associated with the `Spaceships` Mongo collection).

It is also possible to "override" properties and values in the derived model, and so we can simply "override" the `_TYPE` property in the derived model, and
set its default value to "`Battleship`". There won't even be a need for a subclass in this case:

```javascript
var Battleship = Spaceship.derive ({ 
    _TYPE:"Battleship", 
    weapons: [] 
});

var bship = new Battleship("The New Destroyer");
```
Note: you may not set an existing index as a unique (by adding a `$`) in a derived model - doing so will have no effect on the index.
You **may** define new indexes - and only objects instances of the derived class will have them. Indexes defined within a derived model - 
are always defined with the `sparse:true` property on the Mongo DB.

You can read more about indexes and how they are managed in deriveJS [here](#indexes-and-how-they-are-handled-in-the-Mongo-server)


## Getting/restoring/retrieving objects from the Database
You will often want to "restore" existing database objects and populate your local ones with the persisted data. Each Model class have various different static methods used to achieve this; 
most of these are wrappers around certain Mongo `find` queries, which will make the process easier and more intuitive.

There are 4 methods that can be used to retrieve data from the database, here is a brief explanation for each:
* `get` returns **one** object instance.
* `getAll` returns **all** (with an optional filter query) object instances (in an array). There are 3 more additional optional arguments:
`sortBy` - to specify a different index to sort by, using an object such as `{<indexName>: <-1 or 1>}` - use `-1` for descending order, and `1` for ascending (the default is `{MainIndex:-1}`), `limit` - to limit the number of returned results (default is `0`, which is unlimited), `skip` to specify an offset index for retrieved results (default is `0`).
* `map` returns **all** (with an optional filter query) object instances mapped by an index as an object, or as an array.
* `has` returns a boolean indicating if the database contains certain value(s).

All of these methods can use a [`which`](#which-argument) argument, and to understand how to use it, you need to know about `MainIndex`:

###  `MainIndex`
`MainIndex` is an internal value that each model class has and is determined during its definition process. The `MainIndex` will contain the "most important" index for that class/collection.  <br>
Its value will be the first **unique** index defined on the model. <br>
If no unique index is defined, then it will be the first non-unique index defined. <br>
If no index is defined, then it will be the `_id`.

### `which` argument
When you use the `which` argument, you have two options - 
if you pass a **primitive** value (string, number or boolean) - then the function will look for objects where the `MainIndex` is that value,
if you pass an **object** - then that object will be used as a query object for Mongo's `find`. <br>
*Note* if your MainIndex is an object itself - you need to use the normal `find` query format (e.g. if your index-object is called `ob`: `{ob: {prop1:value,prop2:value}}`).


Let's see some examples, we assume the models from the previous examples are already defined.

To get our "`The Beyond`" Spaceship from the database into a local object:

```javascript
    var thebeyond;
    Spaceship.get("The Beyond")
    .then (ship=> {
        thebeyond = ship;
        // thebeyond contains the object from the db
    });
```

Or, using the `async/await` way:

```javascript
async ()=> {
    var thebeyond = await Spaceship.get("The Beyond");
    // thebeyond contains the object from the db
});
```

Put all of our `Spaceship` objects from the db into an array:

```javascript
var spaceships = await Spaceship.getAll();
```

Get all "`_TYPE C`" spaceships into an array:

```javascript
var spaceships = await Spaceship.getAll({_TYPE:"C"});
```

# map
`map` has additional two optional arguments (other than the first `which`): `index`: to specify a different index to be used as the key
for mapping the objects (other than `MainIndex`), and `returnArray`: a boolean specifying if to return the result as an "associative array" of object instances mapped to key indexes or as an object with object instances mapped to index keys.

```javascript
var spaceships = await Spaceship.map();
```
`spaceships` will then be an object, where each key is a `_name` value, and each value is the equivalent `Spaceship` object.
You can then, for example, reference `The Beyond` ship from it:

```javascript
var thebeyond = spaceships["The Beyond"];
```

`map` is obviously meant to be used with a unique index. If it's used with a non-unique one - and several objects exist on the database with duplicate values for an index - then some of the objects will be "overriden" when calling `map`.

So with:
```javascript
var spaceships = await Spaceship.map({},"_TYPE");
```
If we have one Spaceship with `_TYPE` set to `C`, and several others with `_TYPE` as en empty string - then `map` will return only two ships:
One of the empty string ones, and the `C` one.

We can use the `which` argument to further filter-out the objects, for example - return all `_TYPE C` ships
(they will *still* be mapped to their `_name`s):

```javascript
var spaceships = await Spaceship.map({_TYPE:"C"});
```

The last method `has` can be used to determine if a certain object exist on the database. For example:

```javascript
var hasTheBeyond = await Spaceship.has("The Beyond");
```
Will return `true` if a Spaceship object with its `_name` set to "`The Beyond`" exist on the db.
The method also have a second argument - `returnDocument`, a boolean that if set to `true` will also return the object if it exist on the db 
(or `false` if it doesn't).

#### A word of caution for when using the `get` functions: ####
Upon retrieving the objects from the database - their `constructor` functions **will** be called for each object.
Therefore - if you override the constructor and have any code that affects or changes the data there - it **will** run - that is usually *not* desired when retrieving data object, so you should make sure you call the `get` functions from a (usually "higher") class that runs a constructor that does not change the data (like the default constructor).

### `$DefaultCriteria`

All model classes has a "static" property - `$DefaultCriteria`, this is an object containing key-value pairs that will be added by default to database queries, when calling one of the `get` methods, using a primitive value as an argument. This is useful when creating derived or extended classes, and not wanting to include objects from the super-classes in query results. It will be more clear with an example:

Returning to our Spaceship example, we define a `Spaceship` super-model, as before:

```javascript
    var Spaceship = Model({
        _name$: "",
        TYPE: "",
        crew: [],
    }, "Spaceship");
```

Then we define a sub-model of `Spaceship`: `Battleship`

```javascript
var Battleship = Spaceship.derive ({ 
    _TYPE:"Battleship", 
    weapons: [] 
});
```

If we call `getAll` on `Battleship`: 
```javascript
var await battleships = Battleship.getAll();
```

then we'll get all **`Spaceship`** objects in the entire `Spaceship` collection into battleships, while we probably only want to get back the "derived" **`Battleship`** objects. When we want to differentiate the `Battleship` objects from the others in the collection - we can add certain key:value pairs into the `$DefaultCriteria`;
to do so, we add an underscore (`_`) character to the *end* of the property name. So, we can add the `_TYPE` in `Battleship`:

```javascript
var Battleship = Spaceship.derive ({ 
    _TYPE_:"Battleship",
    weapons: [] 
});
```
When we do that, then `_TYPE:"Battleship"` will be added to the find query when we call `get` methods from `Battleship`, and so, for example, 
calling `getAll`: 

```javascript
var await battleships = Battleship.getAll();
```
Will now return just the `Spaceship` objects that also has their `_TYPE` set to "`Battleship`".

*Note*: You shouldn't access `$DefaultCriteria` directly. In case you do, make sure you set its properties, and **not** override it completely.

## Using model instances as values in other models

Let's define a new model: `CrewMember`. The `crew` array of our `Spaceships` will contain `CrewMember` objects:

```javascript
var CrewMember = Model({
    _name: "",
    rank: "",
    role: ""
}, "CrewMember");
```
We can also add a function to the `Spaceship` model, to handle adding new `CrewMembers` to the `crew` array,
(and let's also add a `captain` property)
```javascript
var Spaceship = Model({
    _name$: "",
    TYPE: "",
    captain: null,
    crew: [],
    addCrew: function(crewMember) {
        this.crew.push(crewMember);
    }
},"Spaceship");
```

Next, we create a new `CrewMember` - captain Ricard:

```javascript
var ricard = new CrewMember("Ricard");
ricard.rank = "captain";
ricard.role = "captain";
```

We get `"The Beyond"` spaceship, add `ricard` to its crew, and also set it as its `captain`:
```javascript
var thebeyond = await Spaceship.get("The Beyond");
thebeyond.addCrew(ricard);
thebeyond.captain = ricard;
```

Now if we look at `The Beyond` in the database, we can see:

```
> db.Spaceships.find({_name:"The Beyond"})
{ "_id" : ObjectId("5a0f42663432962910d45ab7"), "_name" : "The Beyond", "_TYPE" : "", "crew" : [ DBRef("CrewMembers", ObjectId("5a1c9a63b3c2df42587b6a90")) ], "captain" : DBRef("CrewMembers", ObjectId("5a1c9a63b3c2df42587b6a90")) }
```

The `CrewMember` object was saved as a `DBRef` object. A `DBRef` is a "reference" to an item from another collection (in this case the `CrewMembers` collection). It contains the `ObjectId` of the item, and the collection name.
To "dereference" the object, you can use the `get` function by passing it the DBRef itself. So, if we want to get back captain Ricard, from `The Beyond`'s `crew` array, we can use:

```javascript
var thebeyond = await Spaceship.get("The Beyond");
var ricard = await CrewMember.get(thebeyond._captain);
```



## Indexes and how they are handled in the Mongo server

Indexes in collections are saved in 4 different compound indexes (specified by their index name:)
* "`nonUnique`": an index containing all non unique (non-sparse) indexes
* "`unique`": an index containing all unique (non-sparse) indexes
* "`sparse_nonUnique`": an index containing all sparse non-unique indexes -- non-unique indexes defined in derived models.
* "`sparse_unique`": an index containing all sparse unique indexes -- unique indexes defined in derived models.

Collections may have only some or none of these indexes defined, depending on indexes defined on the model.
There will also be the `_id` index defined, as usual.

## Putting it all together:
The following is a complete demonstration, expanding on the `Spaceship` idea and models. <br>
The following code examples can also be found in [this github repository](https://github.com/yuval-a/spaceships-derivejs-demo).

### Defining our models
First we define all of our data models, in a separate `Models.js` file:

```javascript
module.exports = new Promise( (resolve,reject)=> {
    var Models = {};

    const derive = require('derivejs');

    derive.Model
    ({
        dbUrl: "mongodb://localhost:27017/",
        dbName: "spaceshipyard",
        debugMode: false
    })
    .then(
        async Model=> {

            Models.Weapon = Model({
                _TYPE:"",
                _DAMAGE:-1,
                armed: false,
                arm: function() {
                    this.armed = true;
                },
                unarm: function() {
                    this.armed = false;
                },
                fire: function(target) {
                    if (!this.armed) {
                        console.log ("Weapon is not armed!");
                        return;
                    }
                    if (target.shields.up) {
                        target.shields.percent -= this._DAMAGE;
                    }
                    else {
                        target.integrityHull -= this._DAMAGE;
                    }
                },
                _inserted: function() {
                    if (this.$ready) this.$ready.call(this);
                },
                // For a weapon-ready callback
                $ready: null
            }, "Weapon");
            
            Models.PhotonTorpedos = class extends Models.Weapon
            .derive({
                _TYPE_: "Photon Torpedos",
                _DAMAGE: 20
            }) {
                constructor(readyCallback) {
                    super ();
                    this.$ready = readyCallback;
                }
            };
            
            Models.CrewMember = Model({
                _name: "",
                rank: "",
                role: ""
            }, "CrewMember");
            
            Models.Spaceship = Model({
                _name: "",
                TYPE: "",
                shields: {
                    up: false,
                    percent: 100
                },
                integrityHull: 100,
                crew: [],
                addCrew: function (crewMember) {
                    this.crew.push(crewMember);
                },
                raiseShields: function() {
                    this.shields.up = true;
                    console.log (this._name+": shields are up");
                },
                lowerShields: function() {
                    this.shields.up = false;
                    console.log (this._name+": shields are down");
                },
                captain: "",
                // Listen to changes on this properties
                $Listen: [ "shields.percent", "integrityHull" ]
            }, "Spaceship");
            
            Models.Cruiser = Models.Spaceship
            .derive({
                TYPE_: "Cruiser"
            });

            Models.Battleship = Models.Spaceship
            .derive({
                TYPE_: "Battleship",
                weapons: [],
                attack: function(target, weaponIndex) {
                    Models.Weapon.get(this.weapons[weaponIndex])
                    .then(w=> {
                        if (!w.armed) w.arm();
                        w.fire(target);
                    });
                }
            });

            resolve (Models);
        }
    )
});
```

### Writing our app
The app code will be in an `app.js` file:

```javascript
require ("./Models")
.then(async Models=> {

    // Save convient references to our data models
    const PhotonTorpedos  = Models.PhotonTorpedos;
    const CrewMember = Models.CrewMember;
    const Cruiser = Models.Cruiser;
    const Battleship = Models.Battleship;

    // Will contain data instances
    var BoldlyGo, Feisty,
        Ricard, Wort,
        torpedos;

    function clearAll() {
        return Promise.all([
            CrewMember.clear(),
            Cruiser.clear(),
            Battleship.clear()
        ]);
    }
    async function init() {
        console.log ("Creating Boldly Go Cruiser");
        BoldlyGo = new Cruiser ("The Boldly Go");
        console.log ("Creating Feisty Battleship");
        Feisty = new Battleship ("The Feisty");

        console.log ("Creating Ricard Crew Member");
        Ricard = new CrewMember("Ricard");
        Ricard.role = "captain";
        Ricard.rank = "captain";

        console.log ("Adding Ricard to Boldly Go")
        BoldlyGo.addCrew (Ricard);
        BoldlyGo.captain = Ricard;

        console.log ("Creating Wort Crew Member");
        Wort = new CrewMember("Wort");
        Wort.role = "captain";
        Wort.rank = "commander";

        console.log ("Adding Wort To Feisty");
        Feisty.addCrew(Wort);
        Feisty.captain = Wort;

    }

    function restore() {
        return Promise.all([
            Cruiser.get("The Boldly Go"),
            Battleship.get("The Feisty")
        ]);
    }

    function battle() {
        console.log ("Starting battle");
        BoldlyGo.raiseShields();
        Feisty.attack(BoldlyGo, 0);
    }

    console.log ("Clearing all...");
    await clearAll();
    init();
    console.log ("Adding Photon Torpedos to Feisty");
    // Wait until PhotonTorpedos are added to Feisty, then run a battle
    Feisty.weapons.push( new PhotonTorpedos(function() {
        console.log ("Photon Torpedos ready")
        battle();
    }) );

    /* 
    // You can also use Spaceship.map, but this is done here for the sake of example:
    restore()
    .then(ships=> {
        BoldlyGo = ships[0];
        Feisty   = ships[1];
        BoldlyGo.lowerShields();
        Feisty.attack(BoldlyGo, 0);
    });
    */
    
})
.catch (err=> {
    console.log ("Error initializing models: ",err);
});
```

If we run the app we can see all the data creation messages appearing asynchronously, along with the battle messages:

    Starting battle
    The Boldly Go: shields are up
    The Boldly Go: shields.percent changed from 100 to 80 

The Boldly Go has raised its shields, and was then attacked by the Feisty's Photon Torpedos, lowering its shields from 100 percent to 80 percent. These last message is from the built-in `changed` method, as we registered `shields.percent` for listening.

If we look at our database in our Spaceship collection, we can see `The Boldly Go` record with `shields.percent` as `80`.

If we now comment the last section, and comment-out this section:

```javascript
restore()
.then(ships=> {
    BoldlyGo = ships[0];
    Feisty   = ships[1];
    BoldlyGo.lowerShields();
    Feisty.attack(BoldlyGo, 0);
});
```
Then run the app again, then we will eventually see these messages:

    The Boldly Go: shields are down
    The Boldly Go: integrityHull changed from 100 to 80

The last one is from the `change` method.
After we restore our ships data from the database - 
then The Boldly Go lowers its shields, and attacked by Feisty again - 
with the shields down - The Boldly Go "integrity hull" suffers a damage of 20 percent.

## Advanced subjects
### Join
You can perform a "join" query with the `join` static method all model classes have:
`join(which,joinWith,localField,foreignField,joinAs,returnAsModel=false)`

* `which` is the criteria for the document to retrieve from the "primary" ("local" collection),
* `joinWith` is the name of the "secondary" ("foreign") collection (as a string).
* `localField` is the name of the field that is equivalent to the `foreignField` on the secondary collection.
* `joinAs` is the name of a property where the "joined" document will be included into.
`returnAsModel` - if set to true, then the function will return an instance of the model (as in when using the `get` function) - you will most likely **not** want to set it to `true`, as the model will have "foreign" fields - and once you try setting or changing them - it will try to persist it to the db. 
This function is usually used only for getting "readonly" data, and not data you want to modify or change.

#### An example use case:
Let's say you have a `Posts` collection and a `User` collection, and you want to get the data for a certain post, and join it with the user data of the user who posted it. With the following assumptions:
* You have a `Post` model defined, with `_email` as its primary key, and `_authorId` with a string id containing the id of the user who posted it.
* Your `Users` collection documents have a `_userId` field with string ids

```javascript
Post.join("user@email.com","Users","_authorId","_userId","author").then(
    post=> {
        // Now the post object here, will also have an "author" field containing all the data for the user with _authorId/_userId
    }
);
```
Note: Use join to join with a single document from another collection.

### `joinAll`
* `joinAll` lets you join data from two separate collections, and return multiple results.
The function accepts the following arguments:
* `which` is the criteria for the document to retrieve from the "primary" ("local" collection),
* `joinOpts` is an object with different options regarding the join:
    * `joinWith`: the name of the "secondary" ("foreign") collection (as a string).
    * `localField`: the name of the field that is equivalent to the `foreignField` on the secondary collection.
    * `foreignField`: the name of the field on the joined collection, equivalent to `localField`
    * `joinAs` is the name of a property where the "joined" document will be included into.
* `findOpts` lets you specify additional "post-find" options, an object that can contain the following:
    * `sortBy`: to return results sorted by a certain index, use Mongo's format for a sort-object,
        e.g.: `{_date:-1}`, this will sort by the `_date` index in a **descending** order. To sort in an ascending
        order, use `1` (positive 1) as the value.
    * `skip`: lets you skip a number of results,
    * `limit`: lets you limit the number of results returned.    
* `returnAsModel` if set to true, then the function will return an instance of the model (as in when using the `get` function) - see notes about this in the documentation for `join`, and why you should almost never need to set this to
`true`.

### Access the "raw" mongoDB collection object
Although DeriveJS is designed, written, and intended to be in charge of all data persistence operations transparently in the background without direct interference,
there might come a rare occasion where you will need access to the collection object, to perform native MongoDB operations "yourself" 
(something that should generally be avoided, and should rarely happen - if you encounder a native MongoDB operation that DeriveJS doesn't enable - I would appreciate if you contact me via Github and tell me about it).
To get access to the MongoDB collection associated with a data model class, you can call the static method `collection()` of the class, which will return the assosicated [NodeJS MongoDB driver collection object](https://mongodb.github.io/node-mongodb-native/api-generated/collection.html).

