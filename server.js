const express = require("express");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const cors = require("cors");
const { getConnection } = require("./config/db.config");
const { registerSchema } = require("./utils/modelFactory");

dotenv.config();

// Import all schemas for registration with the factory
const { User } = require("./models/user.model");
const userSchema = User.schema;
const analysisSchema = require("./models/analysis.model").schema;
const bankStatementSchema = require("./models/bankStatement.model").schema;
const customerSchema = require("./models/customer.model").schema;
const creditNotesSchema = require("./models/creditnotes.model").schema;
const expenseSchema = require("./models/expense.model").schema;
const invoiceSchema = require("./models/invoice.model").schema;
const orderSchema = require("./models/Order").schema;
const paymentSchema = require("./models/payment.model").schema;
const paymentLinkSchema = require("./models/paymentLinks.model").schema;
const purchaseInvoiceSchema = require("./models/Purchase").schema;
const {
  Permission: permissionSchema,
  Resource: resourceSchema,
} = require("./models/rbac.model");
const returnSchema = require("./models/returns.model").schema;
const salesSchema = require("./models/sales.model").schema;
const salesOrderSchema = require("./models/salesOrder.model").schema;
const tagSchema = require("./models/tags.model").schema;

// Register all schemas with the factory
registerSchema("User", userSchema);
registerSchema("Analysis", analysisSchema);
registerSchema("BankStatement", bankStatementSchema);
registerSchema("Customer", customerSchema);
registerSchema("CreditNotes", creditNotesSchema);
registerSchema("Expense", expenseSchema);
registerSchema("Invoice", invoiceSchema);
registerSchema("Order", orderSchema);
registerSchema("Payment", paymentSchema);
registerSchema("PaymentLink", paymentLinkSchema);
registerSchema("PurchaseInvoice", purchaseInvoiceSchema);
registerSchema("Permission", permissionSchema);
registerSchema("Resource", resourceSchema);
registerSchema("Return", returnSchema);
registerSchema("Sale", salesSchema);
registerSchema("SalesOrder", salesOrderSchema);
registerSchema("Tag", tagSchema);

// Import middleware
const authMiddleware = require("./middleware/newauth.middleware");
const modelsMiddleware = require("./middleware/models.middleware");

// Import routes
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
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
const SalesOrderRoutes = require("./routes/salesOrder.routes");
const CustomerRoutes = require("./routes/customer.routes");
const ExpenseRoutes = require("./routes/expense.routes");
const RolesRoutes = require("./routes/rbac.routes");
const OverviewController = require("./routes/overview.routes");
const PermissionRoutes = require("./routes/permission.routes");
const auth2Routes = require("./routes/auth2.routes");

const app = express();

// Middleware setup
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://halalfoods.s3-website.eu-north-1.amazonaws.com",
      "halalfoods.s3-website.eu-north-1.amazonaws.com",
      "https://finance.foodservices.live"
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
app.use((req, res, next) => {
  // Extend the timeout for all requests
  req.setTimeout(600000); // 10 minutes
  res.setTimeout(600000); // 10 minutes
  next();
});

app.get("/", (req, res) => {
  res.send("Hello World from Halal Foods!");
});

// Connect to default database
getConnection("MSF Halal New Live")
  .then(() => console.log("Connected to default database"))
  .catch((err) => console.error("Default database connection error:", err));

// Apply auth and models middleware globally for protected routes
// Exclude /api/auth from auth middleware since it needs to be public
app.use("/api/auth", authRoutes);
app.use("/api/auth2", auth2Routes);

// Apply auth and models middleware to all other API routes
app.use("/api", authMiddleware);
app.use("/api", modelsMiddleware);

// Protected routes
app.use("/api/users", userRoutes);
app.use("/api/rbac", RolesRoutes);
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
app.use("/api/sales-orders", SalesOrderRoutes);
app.use("/api/expenses", ExpenseRoutes);
app.use("/api/overview", OverviewController);
app.use("/api/permissions", PermissionRoutes);

app.post("/api/verify", (req, res) => {
  console.log(req.body);
  res.send("Received");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
