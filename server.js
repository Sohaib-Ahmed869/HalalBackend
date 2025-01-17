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
const PaymentLinksRoutes = require("./routes/paymentLinks.routes");
const CustomerRoutes = require("./routes/customer.routes");
dotenv.config();

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://halalfoods.s3-website.eu-north-1.amazonaws.com",
      "halalfoods.s3-website.eu-north-1.amazonaws.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    exposedHeaders: ["Authorization"],
  })
);
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// Add body-parser with increased limits
const bodyParser = require("body-parser");
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));

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
app.use("/api/payment-links", PaymentLinksRoutes);
app.use("/api/customers", CustomerRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
