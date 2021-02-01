const ObjectID = require('mongodb').ObjectID;
module.exports = {

    indexName: "_id",
    Create: function(document) {
        if (!document.hasOwnProperty(this.indexName)) document[this.indexName] = new ObjectID();
        if (document._created) document._created();
        return document;
    },
    Update: 
        function (index, prop, value) {
        return {
            updateOne : {
                [this.indexName]: index.toString(),
                filter: { [this.indexName]: index },
                update: { $set: { [prop]: value } }
            }
        }

    },
    Unset: 
        function (index, prop) {
        return {
            updateOne : {
                [this.indexName]: index.toString(),
                filter: { [this.indexName]: index },
                update: { $unset: { [prop]: "" } }
            }
        }
    },

    Error: {
        DUPLICATE: 11000
    }
    
}