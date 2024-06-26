import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import multer from "multer";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import crypto from "crypto";
import bcrypt from "bcrypt";
import cors from "cors";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
dotenv.config();
const saltRounds = 10;

const randomImageName = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("hex");

const bucketRegion = process.env.BUCKET_REGION;
const bucketName = process.env.BUCKET_NAME;
const accessKey = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;

const s3 = new S3Client({
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretAccessKey,
  },
  region: bucketRegion,
});

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
}

const app = express();
app.use(express.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

const stripe = new Stripe(process.env.STRIPE_SECRET);

const storage = multer.memoryStorage({
  limits: {
    fieldSize: 50 * 1024 * 1024,
  },
});
const upload = multer({ storage: storage });

const corsOptions = {
  origin: ["https://ecommerce-bead-store.onrender.com", "https://ecommerce-react-website-six.vercel.app", "http://localhost:3000"],
  credentials: true
};

app.use(cors(corsOptions));

const orderSchema = {
  orderNumber: String,
  userID: String,
  totalItems: Number,
  date: String,
  total: Number,
  items: [
    {
      itemID: String,
      name: String,
      price: Number,
      quantity: Number,
      imageURL: String,
    }
  ],
}

const userSchema = new mongoose.Schema({
  fName: String,
  lName: String,
  email: String,
  password: String,
  role: String,
});

const productSchema = {
  name: String,
  price: Number,
  stock: Number,
  description: String,
  imageName: String,
  imageURL: String,
};

const User = new mongoose.model("User", userSchema);
const Product = new mongoose.model("Product", productSchema);
const Order = new mongoose.model("Order", orderSchema);

app.get("/logout", function (req, res) {
  res.clearCookie("access_token");
  console.log("session destroyed");
  res.send("success");
});

function toTitleCase(str) {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// USER LOGIN, REGISTER, AND EDIT
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const foundUser = await User.findOne({ email: email.toLowerCase() }).exec();

    if (foundUser) {
      const result = await bcrypt.compare(password, foundUser.password);

      if (result) {
        const accessToken = jwt.sign(foundUser._id.toJSON(), process.env.ACCESS_TOKEN_SECRET);

        res.cookie("access_token", accessToken, {
          httpOnly: true,
          secure: true,
          maxAge: 15 * 60 * 1000,
        });

        res.status(200).json({
          message: "Login successful",
          role: foundUser.role,
          accessToken: accessToken,
          _id: foundUser._id,
          fName: foundUser.fName,
          lName: foundUser.lName,
          email: foundUser.email
        });
      } else {
        res.status(401).json({ error: "Invalid credentials." });
      }
    } else {
      res.status(404).json({ error: "User not found." });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to login." });
  }
});

app.post("/register", async (req, res) => {
  try {
    const foundUser = await User.findOne({ email: req.body.email.toLowerCase() }).exec();

    if (foundUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hash = await bcrypt.hash(req.body.password, saltRounds);

    const fName = toTitleCase(req.body.fName);
    const lName = toTitleCase(req.body.lName);
    console.log(fName);
    console.log(lName);
    

    const newUser = new User({
      fName: fName,
      lName: lName,
      email: req.body.email.toLowerCase(),
      password: hash,
      role: "User",
    });

    await newUser.save();

    const accessToken = jwt.sign(newUser._id.toJSON(), process.env.ACCESS_TOKEN_SECRET);

    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: true,
      maxAge: 15 * 60 * 1000,
    });

    res.status(201).json({
      message: "User added successfully",
      role: newUser.role,
      accessToken: accessToken,
      _id: newUser._id,
      fName: newUser.fName,
      lName: newUser.lName,
      email: newUser.email
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to register user." });
  }
});

app.put("/edit-user", async (req, res) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.body._id },
      { fName: req.body.fName, lName: req.body.lName, email: req.body.email },
      { new: true }
    ).exec();

    if (!updatedUser) {
      res.status(500).json({ error: "Could not find user in the database." });
    }

    res.status(201).json({
      fName: updatedUser.fName,
      lName: updatedUser.lName,
      email: updatedUser.email
    });
  } catch (err) {
    res.status(500).json({ err: err });
  }
});

// PRODUCT GET, POST, PUT, DELETE FUNCTIONALITY
app.get("/products", async (req, res) => {
  try {
    const foundProducts = await Product.find({}).exec();

    if (foundProducts) {
      res.send(foundProducts);
    } else {
      res.status(500).json({ error: "Failed to get products." });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to get products." });
  }
});

app.post("/products", upload.single("image"), async (req, res) => {
  try {
    const foundProduct = await Product.findOne({ name: req.body.name }).exec();

    if (foundProduct) {
      return;
    }

    const imageName = randomImageName();

    const params = {
      Bucket: bucketName,
      Key: imageName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    };

    const putCommand = new PutObjectCommand(params);

    await s3.send(putCommand);

    const url = `https://${bucketName}.s3.${bucketRegion}.amazonaws.com/${imageName}`;

    const product = new Product({
      name: req.body.name,
      price: req.body.price,
      stock: req.body.stock,
      description: req.body.description,
      imageName: imageName,
      imageURL: url,
    });

    await product.save();
    res.status(201).json({ message: "Product added successfully." });
  } catch (err) {
    res.status(500).json({ error: "Failed to add product." });
  }
});

app.put("/products", upload.single("image"), async (req, res) => {
  try {
    let product = await Product.findOne({ _id: req.body._id }).exec();
    if (product && product.imageURL != req.body.image) {
      let params = {
        Bucket: bucketName,
        Key: product.imageName
      }
      const deleteCommand = new DeleteObjectCommand(params);
      await s3.send(deleteCommand);
      const imageName = randomImageName();

      params = {
        Bucket: bucketName,
        Key: imageName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      const putCommand = new PutObjectCommand(params);

      await s3.send(putCommand);

      const url = `https://${bucketName}.s3.${bucketRegion}.amazonaws.com/${imageName}`;

      product = await Product.findOneAndUpdate({_id: req.body._id}, {name: req.body.name, price: req.body.price, stock: req.body.stock, description: req.body.description, imageURL: url})

      await product.save();
      res.status(201).json({ message: "Product updated successfully." });
    } else {
      product = await Product.findOneAndUpdate({_id: req.body._id}, {name: req.body.name, price: req.body.price, stock: req.body.stock, description: req.body.description})

      await product.save();
      res.status(201).json({ message: "Product updated successfully." });
    }  
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update product." });
  }
})

app.delete("/products", async (req, res) => {
  try {
    await Product.deleteOne({ name: req.body.name });

    const params = {
      Bucket: bucketName,
      Key: req.body.imageName
    }
    const deleteCommand = new DeleteObjectCommand(params);
    await s3.send(deleteCommand);

    res.status(201).json({message: "Product deleted successfully!"});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete product." });
  }
});

app.post('/create-checkout-session', async (req, res) => {
  try {
    const cartItems = req.body.cart;

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty.' });
    }

    const lineItems = cartItems.map((cartItem) => {
      return {
        price_data: {
          currency: 'cad',
          product_data: {
            name: cartItem.name,
          },
          unit_amount: (cartItem.price * 100).toFixed(0),
        },
        quantity: cartItem.qty,
      };
    });

    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'],
      },
      shipping_options: [
        {
          shipping_rate: 'shr_1NgeexBOwjCk5ssXZtsy0p51',
        },
      ],
      custom_fields: [
        {
          name: 'Order Number',
          value: '123456789',
        },
      ],
      mode: 'payment',
      success_url: `http://localhost:3000/#/OrderSuccess`,
      cancel_url: `http://localhost:3000/#/Cart`,
      automatic_tax: {
        enabled: true,
      },
    });

    res.json({url: session.url});
  } catch (error) {
    console.error('Error creating checkout session:', error.message);
    res.status(500).send('Error creating checkout session');
  }
});

app.get("/orders", async (req, res) => {
  try {
    const userID = req.query._id;
    const userRole = req.query.role;
    let orders;

    if (userRole === "Admin") {
      // Get all orders from the database and send them to the client side as a JSON object
      orders = await Order.find({}).exec();
      res.json(orders);
    } else {
      orders = await Order.find({userID: userID}).exec();
      res.json(orders);
    }
  } catch (err) {
    console.error('Error getting orders from the database: ', err.message);
    res.status(500).send('Error getting orders.');
  }
});

app.post("/add-order", async (req, res) => {
  try {
    const cartItems = req.body.cart;
    const userId = req.body.user._id;

    let totalPriceOverall = 0;
    let totalItems = 0;

    const items = await Promise.all(cartItems.map(async (cartItem) => {
      let price = parseFloat(((parseInt(cartItem.qty) * parseFloat(cartItem.price)).toFixed(2)));
      let quantity = parseInt(cartItem.qty);
      totalPriceOverall = totalPriceOverall + price;
      totalItems = totalItems + quantity;

      const foundItem = await Product.findOneAndUpdate(
        { _id: cartItem._id },
        { $inc: { stock: -quantity } }
      );
      if (!foundItem) {
        console.log("Product failed to update.");
      }

      return {
        itemID: cartItem._id,
        name: cartItem.name,
        quantity: quantity,
        price: price,
        imageURL: cartItem.imageURL
      };
    }));

    const currentDate = new Date();
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June', 
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const month = months[currentDate.getMonth()];
    const day = currentDate.getDate();
    const year = currentDate.getFullYear();

    const formattedDate = `${month} ${day}, ${year}`;

    const objectId = new ObjectId();

    const order = new Order ({
      orderNumber: objectId,
      userID: userId,
      total: (totalPriceOverall + 10).toFixed(2),
      totalItems: totalItems,
      date: formattedDate,
      items: items
    });

    await order.save()
    res.status(201).json({ message: "Order added successfully!" });
  } catch (error) {
    const cartItems = req.body.cart;
    const items = await Promise.all(cartItems.map(async (cartItem) => {
      let quantity = parseInt(cartItem.qty);
      const foundItem = await Product.findOneAndUpdate(
        { _id: cartItem._id },
        { $inc: { stock: +quantity } }
      );
      if (!foundItem) {
        console.log("Product failed to update.");
      }
    }))
    if (!items) {
      console.log("Items failed to update.");
    }
    console.error('Error adding order to database:', error.message);
    res.status(500).send('Error adding order to database.');
  }
})

app.get("/users", async (req, res) => {
  try {
    let users;
    const loggedIn = req.query.loggedIn;
    const role = req.query.role;
    
    if (loggedIn && role === "Admin") {
      users = await User.find({}).exec();
      
      if (users) {
        res.status(201).json(users);
      } else {
        throw new Error("No Users Found");
      }
    } else {
      // Handle the case where conditions are not met
      res.status(400).json({ message: "Access denied." });
    }
  } catch (err) {
    console.log(err);
    res.status(500).send('Error getting users.');
  }
})

const PORT = process.env.PORT || 9000;

connectDB().then(() => {
  app.listen(PORT, () => {
      console.log("listening for requests");
  })
})

// connectDB().then(() => {
//   app.listen(9000, () => {
//       console.log("Listening on port 9000!");
//   })
// })