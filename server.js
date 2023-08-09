import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import multer from "multer";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import crypto from "crypto";
import bcrypt from "bcrypt";
import cors from "cors";
import jwt from "jsonwebtoken";
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

const corsOptions = {
  origin: true,
  optionsSuccessStatus: 200,
  credentials: true
}

app.use(cors());

const storage = multer.memoryStorage({
  limits: {
    fieldSize: 50 * 1024 * 1024,
  },
});
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
  description: String,
  imageName: String,
  imageURL: String,
};

const User = new mongoose.model("User", userSchema);
const Product = new mongoose.model("Product", productSchema);

app.get("/logout", function (req, res) {
  // Clear the access token from the response headers
  res.clearCookie("access_token");
  console.log("session destroyed");
  res.send("success");
});


app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body; // Extract email and password directly

    const foundUser = await User.findOne({ email: email.toLowerCase() }).exec(); // Use the extracted 'email'

    if (foundUser) {
      const result = await bcrypt.compare(password, foundUser.password); // Use the extracted 'password'

      if (result) {
        const accessToken = jwt.sign(foundUser.toJSON(), process.env.ACCESS_TOKEN_SECRET);

        res.cookie("access_token", accessToken, {
          httpOnly: true,
          secure: false, // Set to 'true' if using HTTPS
          maxAge: 7 * 24 * 60 * 60 * 1000, // Expiration time in milliseconds (7 days in this example)
        });

        res.status(200).json({
          message: "Login successful",
          role: foundUser.role,
          accessToken: accessToken,
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
    const newUser = new User({
      email: req.body.email.toLowerCase(),
      password: hash,
      role: "User",
    });

    await newUser.save();

    // Create and sign the access token
    const accessToken = jwt.sign(newUser.toJSON(), process.env.ACCESS_TOKEN_SECRET);

    // Set the access token as an HTTP cookie
    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: false, // Set to 'true' if using HTTPS
      maxAge: 7 * 24 * 60 * 60 * 1000, // Expiration time in milliseconds (7 days in this example)
    });

    res.status(201).json({
      message: "User added successfully",
      role: newUser.role,
      accessToken: accessToken,
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

app.listen(9000, function () {
  console.log("Listening on port 9000");
});
