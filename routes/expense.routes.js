const express = require("express");
const router = express.Router();
const ExpenseController = require("../controllers/expense.controller");

router.post("/", ExpenseController.createExpense);
router.get(
  "/analysis/:analysisId",
  ExpenseController.getExpensesByAnalysis
);
router.get("/tags", ExpenseController.getExpenseTags);
router.get("/", ExpenseController.getAllExpenses);
router.put("/:id", ExpenseController.updateExpense);
router.delete("/:id", ExpenseController.deleteExpense);

module.exports = router;
