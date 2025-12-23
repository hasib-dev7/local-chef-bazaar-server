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
    const paymentCollection = db.collection("payment");
    const reviesCollection = db.collection("reviews");
    const favoritesCollection = db.collection("favorite");
    // get meals..........meals section
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
    // ........... favorite section
    // favorite data post db
    app.post("/favorite", async (req, res) => {
      const body = {
        ...req.body,
        createdAt: new Date(),
      };
      const { userEmail } = req.body;
      const { mealId } = req.body;
      const isExisting = await favoritesCollection.findOne({
        userEmail: userEmail,
        mealId: mealId,
      });
      if (isExisting) {
        return res.status(409).send({
          success: false,
          message: "Meal already added to favorites",
        });
      }
      const result = await favoritesCollection.insertOne(body);
      res.send(result);
    });
    // .............  reviews section
    // reviews post section
    app.post("/reviews", async (req, res) => {
      const body = {
        ...req.body,
        createdAt: new Date(),
      };
      const result = await reviesCollection.insertOne(body);
      res.send(result);
    });
    // reviews data food name id
    app.get("/reviews", async (req, res) => {
      const { foodId } = req.query;
      const result = await reviesCollection.find({ foodId }).toArray();
      res.send(result);
    });
    // get user login email  all reviews data
    app.get("/reviews/:email", async (req, res) => {
      const email = req.params.email;
      const result = await reviesCollection.find({ email: email }).toArray();
      res.send(result);
    });
    // delete reviews data
    app.delete("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      console.log("id.......",id)
      const query = { _id: new ObjectId(id) };
      const result = await reviesCollection.deleteOne(query);
      res.send(result);
    });
    // ................. payment section
    // payment reletive apis
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
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/dashboard/user-orders`,
      });
      res.send({ url: session.url });
    });
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;
      const queryId = { transactionId: transactionId };
      const paymentExisting = await paymentCollection.findOne(queryId);
      if (paymentExisting) {
        return res.send({ message: "already exist", transactionId });
      }
      // payment_status: 'paid',
      if (session.payment_status === "paid") {
        const id = session.metadata.foodId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
          },
        };

        const orderInfo = {
          foodId: session.metadata.foodId,
          chefId: session.metadata.chefId,
          transactionId: session.payment_intent,
          customer_email: session.customer_email,
          customer_name: session.metadata.customer_name,
          amount: session.amount_total / 100,
          payment_status: session.payment_status,
          paidAt: new Date(),
        };
        const result = await orderCollection.updateOne(query, update);
        const paymentResult = await paymentCollection.insertOne(orderInfo);
        return res.send({ success: true, result, paymentResult });
      }

      res.send({ status: false });
    });
    // ........ order section
    // get order user email
    app.get("/orders/:email", async (req, res) => {
      const email = req.params.email;
      const result = await orderCollection
        .find({ "customer.email": email })
        .toArray();
      res.send(result);
    });
    // order request update
    app.patch("/order-request/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const body = req.body;
      const filteredUpdate = {};
      if (body.paymentStatus) filteredUpdate.paymentStatus = body.paymentStatus;
      if (body.orderStatus) filteredUpdate.orderStatus = body.orderStatus;
      const updateDoc = {
        $set: filteredUpdate,
      };
      const result = await orderCollection.updateOne(query, updateDoc);
      res.send(result);
    });
    // order request get data to db
    app.get("/request-orders/:email", async (req, res) => {
      const email = req.params.email;
      console.log();
      const result = await orderCollection
        .find({ chef_email: email })
        .toArray();
      res.send(result);
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
