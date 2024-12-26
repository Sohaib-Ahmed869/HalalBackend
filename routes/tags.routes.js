// routes/tags.routes.js
const express = require("express");
const router = express.Router();
const TagModel = require("../models/tags.model");

router.get("/", async (req, res) => {
  try {
    const tags = await TagModel.find();
    res.json(tags);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/", async (req, res) => {
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
    await TagModel.findByIdAndDelete(req.params.id);
    res.json({ message: "Tag deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
