require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
//  You can also find your test secret API key
const stripe = require("stripe")(process.env.STRIPE_SECRET);
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
    const orderCollection = db.collection("order");
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
      const result = await mealsCollection
        .find({ chef_email: email })
        .toArray();
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
      if (body.image) filteredUpdate.image = body.image;
      if (body.ingredients) filteredUpdate.ingredients = body.ingredients;
      if (body.chefExperience)
        filteredUpdate.chefExperience = body.chefExperience;
      const updateDoc = {
        $set: filteredUpdate,
      };
      const result = await mealsCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // payment reletive apis
    // paymetn endpoint
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      // console.log("payment info", paymentInfo);
      // res.send(paymentInfo);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.foodName,
                images: [paymentInfo?.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.customer?.email,
        mode: "payment",
        metadata: {
          foodId: paymentInfo?.foodId,
          customer_name: paymentInfo?.customer.name,
          chefId: paymentInfo?.chefId,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/order-form/${paymentInfo?.foodId}`,
      });
      res.send({ url: session.url });
    });
    // payment susscess
    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const query = session.metadata.foodId;
      const meal = await mealsCollection.findOne({ _id: new ObjectId(query) });
      console.log(meal);
      // status: 'complete'
      if (session.status === "complete") {
        // save order data fron mongodb
        const orderInfo = {
          foodId: session.metadata.foodId,
          chefId: session.metadata.chefId,
          transactionId: session.payment_intent,
          customer_email: session.customer_email,
          customer_name: session.metadata.customer_name,
          status: "pending",
        };
      }
    });
    
    // meal order post save to bd
    app.post("/orders", async (req, res) => {
      const { foodId, customer } = req.body;
      const email = customer?.email;
      // check if user already ordered this meal
      const existingOrder = await orderCollection.findOne({
        foodId: foodId,
        "customer.email": email,
      });
      if (existingOrder) {
        return res
          .status(400)
          .send({ error: "You have already ordered this meal!" });
      }
      const orderData = {
        ...req.body,
        oderTime: new Date(),
      };

      // console.log(id,email);
      const result = await orderCollection.insertOne(orderData);
      res.send(result);
    });
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
