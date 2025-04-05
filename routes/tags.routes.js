// routes/tags.routes.js
const express = require("express");
const router = express.Router();
const TagModel = require("../models/tags.model");
const { getModel } = require("../utils/modelFactory");

router.get("/", async (req, res) => {
  try {
    // Get the database connection from the request
    const TagModel = getModel(req.dbConnection, "Tag");
    const tags = await TagModel.find();
    res.json(tags);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/", async (req, res) => {
  const TagModel = getModel(req.dbConnection, "Tag");

  const tag = new TagModel({
    name: req.body.name,
    category: req.body.category,
  });

  try {
    const newTag = await tag.save();
    res.status(201).json(newTag);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const TagModel = getModel(req.dbConnection, "Tag");

    await TagModel.findByIdAndDelete(req.params.id);
    res.json({ message: "Tag deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
