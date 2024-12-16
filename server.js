const express = require("express");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const cors = require("cors");
const mongoose = require("mongoose");

const authRoutes = require("./routes/auth.routes");
const depositRoutes = require("./routes/deposit.routes");
const invoiceRoutes = require("./routes/invoice.routes");
const orderRoutes = require("./routes/order.routes");
const purchaseRoutes = require("./routes/purchase.routes");
const salesRoutes = require("./routes/sales.routes");

dotenv.config();

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/deposits", depositRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/sales", salesRoutes);


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
