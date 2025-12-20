require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

const app = express();
// middleware
app.use(cors());
app.use(express.json());
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URL, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("mealsDB");
    const mealsCollection = db.collection("meal");
    // get meals
    app.get("/meals", async (req, res) => {
      const result = await mealsCollection.find().toArray();
      res.send(result);
    });
    // get meals single data
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const cursor = { _id: new ObjectId(id) };
      const result = await mealsCollection.findOne(cursor);
      res.send(result);
    });
    // post meals
    app.post("/meals", async (req, res) => {
      const cursor = { ...req.body, createdAt: new Date() };

      const result = await mealsCollection.insertOne(cursor);
      res.send(result);
    });
    // get my meals
    app.get("/my-meals/:email", async (req, res) => {
      const email = req.params.email;
      const result = await mealsCollection.find({ email }).toArray();
      res.send(result);
    });
    // delete my meals card
    app.delete("/my-meals/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.deleteOne(query);
      res.send(result);
    });
    // update my meals card
    app.patch("/my-meals/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const body = req.body;
      const filteredUpdate = {};
      if (body.foodName) filteredUpdate.foodName = body.foodName;
      if (body.price) filteredUpdate.price = body.price;
      if (body.deliveryTime) filteredUpdate.deliveryTime = body.deliveryTime;
      if (body.imageURL) filteredUpdate.imageURL = body.imageURL;
      if (body.ingredients) filteredUpdate.ingredients = body.ingredients;
      if (body.chefExperience)
        filteredUpdate.chefExperience = body.chefExperience;
      const updateDoc = {
        $set: filteredUpdate,
      };
      const result = await mealsCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
//
app.get("/", (req, res) => {
  res.send("Hello food lovers..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
