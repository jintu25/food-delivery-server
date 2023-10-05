const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
const jwt = require("jsonwebtoken");

require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middleware
app.use(cors());
app.use(express.json());
// require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const verifyJwt = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  // bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.JWT_ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.t6zznhm.mongodb.net/?retryWrites=true&w=majority`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    const menuCollection = client.db("foodDb").collection("menu");
    const reviewCollection = client.db("foodDb").collection("reviews");
    const cartCollection = client.db("foodDb").collection("carts");
    const usersCollection = client.db("foodDb").collection("users");
    const paymentsCollection = client.db("foodDb").collection("payments");

    // jwt token
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_ACCESS_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token });
    });
    // verifyAdmin
    // use verifyJwt before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access.." });
      }
      next();
    };

    // ----- menu related api -----
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });
    app.post("/menu", verifyJwt, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem);
      res.send(result);
    });
    app.delete("/menu/:id", verifyJwt, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });
    // ------ reviews related api -----
    app.get("/review", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // ----- user related api -----
    app.get("/users", verifyJwt, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      
      if (existingUser) {
        return res.send({ message: "user already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/admin/:email", verifyJwt, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    // updated user for use patch method
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    //user delete method and delete user
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // ---- carts add in database ----
    // create cart item product
    app.get("/carts", verifyJwt, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }
      const decodedEmail = req.decoded.email;
     
      if (email !== decodedEmail) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // updated cart item
    app.post("/carts", async (req, res) => {
      const item = req.body;
  
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });
    // deleted cart item product
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });
    // admin home states api
    app.get('/admin-stats', verifyJwt, verifyAdmin, async(req, res) => {
      const users = await usersCollection.estimatedDocumentCount()
      const products = await cartCollection.estimatedDocumentCount()
      const orders = await paymentsCollection.estimatedDocumentCount()

      const payments = await paymentsCollection.find().toArray()
      const revenue = payments.reduce((sum, payment) => sum + payment.price , 0)
      res.send({
        revenue,
        users,
        products,
        orders
      })
    })


    // payment method

    app.post("/create-payment-intent", verifyJwt, async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;
      
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    // payment related api

    // post method
    app.post('/payments', verifyJwt, async(req, res) => {
      const payment = req.body;
      const insertResult = await paymentsCollection.insertOne(payment)
      const query = {_id:  { $in: payment.cartItems.map(id => new ObjectId(id))}}
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({insertResult, deleteResult})
    })

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

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
