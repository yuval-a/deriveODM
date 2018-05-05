const ObjectID = require('mongodb').ObjectID;
module.exports = {

    indexName: "_id",
    Create: function(document) {
        document._id = new ObjectID();
        return document;
    },
    Update: 
        function (index,prop,value) {
        return {
            updateOne : {
                [this.indexName]: index.toString(),
                filter: { [this.indexName]: index },
                update: { $set: { [prop]: value } }
            }
        }

    },

    Error: {
        DUPLICATE: 11000
    }
    
}

