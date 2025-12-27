require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
//  You can also find your test secret API key
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());
// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  // console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log(decoded);
    next();
  } catch (err) {
    // console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};
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
    const usersCollection = db.collection("user");
    const roleCollection = db.collection("role");
    // role middlewares
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Admin only Actions!", role: user?.role });

      next();
    };
    // post user data .......user role section
    app.post("/users", async (req, res) => {
      const userData = req.body;
      const query = { email: userData.email };
      const alreadyExist = await usersCollection.findOne(query);
      if (alreadyExist) {
        const updateOn = {
          $set: { lastLogin: new Date().toISOString() },
        };
        const updateResult = await usersCollection.updateOne(query, updateOn);
        return res.send(updateResult);
      }
      // new user
      userData.role = "user";
      userData.status = "active";
      userData.createdAtLogin = new Date().toISOString();
      userData.lastLogin = new Date().toISOString();
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });
    // GET /users
    app.get("/users", verifyJWT, verifyADMIN, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    });
    // get user email data
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });
    // PATCH /users/fraud/:userId
    app.patch(
      "/users/fraud/:userId",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        try {
          const { userId } = req.params;
          // Validate userId
          if (!userId) {
            return res.status(400).send({ message: "User ID is required" });
          }
          // Find user
          const user = await usersCollection.findOne({
            _id: new ObjectId(userId),
          });
          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }
          // Admins cannot be fraud
          if (user.role === "admin") {
            return res
              .status(400)
              .send({ message: "Admin cannot be marked as fraud" });
          }
          // Already fraud?
          if (user.status === "fraud") {
            return res.status(400).send({ message: "User is already fraud" });
          }
          // Update user status to fraud
          await usersCollection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { status: "fraud" } }
          );

          res.send({ message: `${user.name} has been marked as fraud ` });
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );
    // get user's role ....role section
    app.get("/user/role", verifyJWT, async (req, res) => {
      // console.log("veriy email",req.tokenEmail);
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });
    // get user profile data
    app.get("/user/profile", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await usersCollection.find({ email }).toArray();
      res.send(result);
    });
    // admin section..........
    // get all role requests
    app.get("/role-requests", verifyJWT, verifyADMIN, async (req, res) => {
      const result = await roleCollection.find().toArray();
      res.send(result);
    });
    // approve request
    app.patch(
      "/role-requests/approve/:id",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        const requestId = req.params.id;
        const request = await roleCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request) {
          return res.status(404).send({ message: "Request not found" });
        }
        //  Chef request
        if (request.requestType === "chef") {
          const chefId = `chef-${Math.floor(1000 + Math.random() * 9000)}`;
          await usersCollection.updateOne(
            { _id: new ObjectId(request.userId) },
            {
              $set: {
                role: "chef",
                chefId: chefId,
              },
            }
          );
        }
        //  Admin request
        if (request.requestType === "admin") {
          await usersCollection.updateOne(
            { _id: new ObjectId(request.userId) },
            {
              $set: { role: "admin" },
            }
          );
        }
        //  Update request status
        await roleCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { requestStatus: "approved" } }
        );
        res.send({ message: "Request approved successfully" });
      }
    );
    // reject request
    app.patch(
      "/role-requests/reject/:id",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        const requestId = req.params.id;
        const request = await roleCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request)
          return res.status(404).send({ message: "Request not found" });
        await roleCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { requestStatus: "rejected" } }
        );
        res.send({ message: "Request rejected successfully" });
      }
    );
    // Platform Statistics
    app.get(
      "/platform-statistics",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        // Total Payment
        const payments = await paymentCollection
          .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
          .toArray();
        // Total Users
        const totalUsers = await usersCollection.countDocuments();
        // Orders
        const pendingOrders = await orderCollection.countDocuments({
          orderStatus: "pending",
        });
        const deliveredOrders = await orderCollection.countDocuments({
          orderStatus: "delivered",
        });
        // Active Chefs
        const activeChefs = await usersCollection.countDocuments({
          role: "chef",
        });
        // Meals
        const totalMeals = await mealsCollection.countDocuments();
        // Avg Rating - convert rating to number to handle string type
        const ratings = await reviesCollection
          .aggregate([
            {
              $group: {
                _id: null,
                avgRating: { $avg: { $toDouble: "$rating" } }, // convert string to number
              },
            },
          ])
          .toArray();
        res.send({
          totalPayment: payments[0]?.total || 0,
          totalUsers,
          pendingOrders,
          deliveredOrders,
          activeChefs,
          totalMeals,
          avgRating: ratings[0]?.avgRating?.toFixed(1) || 0,
        });
      }
    );
    //..................
    // role request API
    // get role request request type
    app.get("/role/requestType/:userId", async (req, res) => {
      const { userId } = req.params;
      const result = await roleCollection.findOne({
        userId,
        requestStatus: "pending",
      });
      res.send(result);
    });
    // get user chef role
    app.get("/user/chef/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({
        email: email,
        role: "chef",
      });
      res.send(result);
    });
    // POST /role/request
    app.post("/role/request", async (req, res) => {
      try {
        const { userId, requestType } = req.body;
        if (!userId || !requestType) {
          return res
            .status(400)
            .send({ message: "userId and requestType required" });
        }
        //  block if already pending request exists
        const existing = await roleCollection.findOne({
          userId,
          requestStatus: "pending",
        });
        if (existing) {
          return res.status(400).send({
            message: `You already have a pending ${existing.requestType} request`,
          });
        }
        // get user info
        const user = await usersCollection.findOne({
          _id: new ObjectId(userId),
        });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        const newRequest = {
          userId,
          userName: user.name,
          userEmail: user.email,
          requestType,
          requestStatus: "pending",
          requestTime: new Date().toISOString(),
        };
        await roleCollection.insertOne(newRequest);
        res.send({ message: "Role request sent successfully" });
      } catch (err) {
        res.status(500).send({ message: "Server error" });
      }
    });
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
      try {
        const { chefID } = req.body;
        // check if chef exists
        const chef = await usersCollection.findOne({
          _id: new ObjectId(chefID),
        });
        if (!chef) return res.status(404).send({ message: "Chef not found" });
        // block fraud chefs
        if (chef.status === "fraud") {
          return res
            .status(403)
            .send({ message: "You are blocked and cannot create meals 🚫" });
        }
        const mealData = { ...req.body, createdAt: new Date() };
        const result = await mealsCollection.insertOne(mealData);
        res.send({ message: "Meal created successfully ✅", result });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
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
    // favorite data get db
    app.get("/favorite/:email", async (req, res) => {
      const email = req.params.email;
      const query = {
        userEmail: email,
      };
      const result = await favoritesCollection.find(query).toArray();
      res.send(result);
    });
    // favorite meal data delete
    app.delete("/favorite/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await favoritesCollection.deleteOne(query);
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
      const query = { _id: new ObjectId(id) };
      const result = await reviesCollection.deleteOne(query);
      res.send(result);
    });
    // review data update
    app.patch("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const body = req.body;
      const filteredUpdate = {};
      if (body.reviews) filteredUpdate.reviews = body.reviews;
      if (body.rating) filteredUpdate.rating = body.rating;
      const update = {
        $set: filteredUpdate,
      };
      const result = await reviesCollection.updateOne(query, update);
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
      // check if user is fraud
      // const existingUser = await usersCollection.findOne({ email: email });
      // if (!existingUser) {
      //   return res.status(404).send({ error: "User not found!" });
      // }
      // if (existingUser.status === "fraud" && existingUser.role === "user") {
      //   return res
      //     .status(403)
      //     .send({ error: "Fraud user cannot place orders 🚫" });
      // }
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
