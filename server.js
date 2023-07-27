const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const multer = require("multer");

const app = express();

app.use(bodyParser.urlencoded({
    extended: true
}));

mongoose.connect("mongodb://localhost:27017/ecommerceDB");

const userSchema = {
    email: String,
    password: String
};

const productSchema = {
    name: String,
    price: Number,
    stock: Number,
};

const User = new mongoose.model("User", userSchema);
const Product = new mongoose.model("Product", productSchema);


app.get("/", function(req, res) {
    res.send("Looks good");
});

app.post("/register", function(req, res) {
    const user = new User({
        email: req.body.email,
        password: req.body.password
    });

    User.findOne({ email: req.body.email }).exec()
        .then(foundUser => { 
            if (foundUser) {
                res.redirect("/UserProfile");
            } else {
                user.save()
                    .then(() => {
                        res.status(201).json({ message: "User registration successful." });
                    })
                    .catch(err => {
                        res.status(500).json({ error: "Failed to save user." });
                    });
            }
        });
});

app.post("/addproduct", upload.single("file"), async (req, res) => {

    const product = new Product({
        name: req.body.name,
        price: req.body.price,
        stock: req.body.stock,
    });

    Product.findOne({ name: req.body.name }).exec()
      .then(foundProduct => {
        if (foundProduct) {
            res.redirect("/addproduct");
        } else {
            product.save()
                .then(() => {
                    res.status(201).json({ message: "Product added successfully." });
                })
                .catch(err => {
                    res.status(500).json({ error: "Failed to add product." });
                });
        }
      });
});

app.listen(9000, function() {
    console.log("Listening on port 9000");
});
