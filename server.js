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
const AnalysisRoutes = require("./routes/analysis.routes");
const PaymentRoutes = require("./routes/payment.routes");
const TransactionRoutes = require("./routes/transactions.routes");
const BankStatementRoutes = require("./routes/bankStatement.routes");
const TagRoutes = require("./routes/tags.routes");
const CreditNoteRoutes = require("./routes/creditNotes.routes");
const ReturnsRoutes = require("./routes/returns.routes");
dotenv.config();

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://halalfoods.s3-website.eu-north-1.amazonaws.com",
    ],
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-csrf-token",
      "X-Requested-With",
      "Accept",
    ],
    exposedHeaders: ["Authorization"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ limit: "1000mb" }));
app.use(express.urlencoded({ limit: "1000mb", extended: true }));

app.get("/", (req, res) => {
  res.send("Hello World from Halal Foods!");
});

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
app.use("/api/analysis", AnalysisRoutes);
app.use("/api/payments", PaymentRoutes);
app.use("/api/transactions", TransactionRoutes);
app.use("/api/bank-statements", BankStatementRoutes);
app.use("/api/credit-notes", CreditNoteRoutes);
app.use("/api/returns", ReturnsRoutes);
app.use("/api/tags", TagRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
