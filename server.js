import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import multer from "multer";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import crypto from "crypto";
import bcrypt from "bcrypt";
import cors from "cors";
import { log } from "console";
import { resolve } from "path";
dotenv.config();
const saltRounds = 10;

mongoose.connect(process.env.URI);

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
const app = express();
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use(cors());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const userSchema = {
  email: String,
  password: String,
  role: String,
};

const productSchema = {
  name: String,
  price: Number,
  stock: Number,
  imageName: String,
  imageURL: String,
};

const User = new mongoose.model("User", userSchema);
const Product = new mongoose.model("Product", productSchema);

app.post("/login", async (req, res) => {
  try {
    const foundUser = await User.findOne({ email: req.body.email }).exec();

    if (foundUser) {
      const result = await bcrypt.compare(req.body.password, foundUser.password);

      if (result) {
        res.status(200).json({
          message: "Login successful",
          role: foundUser.role,
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
    const foundUser = await User.findOne({ email: req.body.email }).exec();

    if (foundUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hash = await bcrypt.hash(req.body.password, saltRounds);
    const newUser = new User({
      email: req.body.email,
      password: hash,
      role: "User",
    });

    await newUser.save();

    res.status(201).json({
      message: "User added successfully",
      role: newUser.role,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to register user." });
  }
});

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
      return res.redirect("/addproduct");
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
      imageName: imageName,
      imageURL: url,
    });

    await product.save();
    res.status(201).json({ message: "Product added successfully." });
  } catch (err) {
    res.status(500).json({ error: "Failed to add product." });
  }
});

app.listen(9000, function () {
  console.log("Listening on port 9000");
});
