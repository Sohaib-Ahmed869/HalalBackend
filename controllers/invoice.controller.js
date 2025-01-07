const axios = require("axios");
const Invoice = require("../models/invoice.model");
const Payment = require("../models/payment.model");

class InvoiceController {
  static async getInvoices(req, res) {
    try {
      console.log("Query:", req.query);
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const sortField = req.query.sortField || "CreationDate";
      const sortOrder = parseInt(req.query.sortOrder) || -1;
      const { startDate, endDate } = req.query;

      const skip = (page - 1) * limit;
      const sort = { [sortField]: sortOrder };
      let query = {};

      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        query.DocDate = {
          $gte: start,
          $lte: end,
        };
      }

      const totalCount = await Invoice.countDocuments(query);
      const invoices = await Invoice.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();

      res.json({
        data: invoices,
        metadata: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
          limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ error: "Failed to fetch invoices from database" });
    }
  }
  static determinePaymentMethod(invoice) {
    const isPOS =
      invoice.CardCode === "C9999" ||
      invoice.CardName?.toLowerCase().includes("comptoir") ||
      invoice.U_EPOSNo != null;

    const isDelivery =
      invoice.ShipToCode != null ||
      invoice.Address2?.length > 0 ||
      invoice.DocumentDelivery === "ddtYes";

    let paymentMethod = "Unknown";

    if (isPOS) {
      if (
        invoice.PaymentMethod?.toLowerCase().includes("cash") ||
        invoice.Comments?.toLowerCase().includes("cash")
      ) {
        paymentMethod = "POS-Cash";
      } else if (
        invoice.PaymentMethod?.toLowerCase().includes("cheque") ||
        invoice.Comments?.toLowerCase().includes("cheque")
      ) {
        paymentMethod = "POS-Cheque";
      } else if (
        invoice.PaymentMethod?.toLowerCase().includes("credit") ||
        invoice.CardCode !== "C9999"
      ) {
        paymentMethod = "POS-Credit";
      }
    } else if (isDelivery) {
      if (
        invoice.PaymentMethod?.toLowerCase().includes("cash") ||
        invoice.Comments?.toLowerCase().includes("cash")
      ) {
        paymentMethod = "Delivery-Cash";
      } else if (
        invoice.PaymentMethod?.toLowerCase().includes("cheque") ||
        invoice.Comments?.toLowerCase().includes("cheque")
      ) {
        paymentMethod = "Delivery-Cheque";
      } else {
        paymentMethod = "Delivery-Credit";
      }
    }

    return {
      paymentMethod,
      isPOS,
      isDelivery,
    };
  }

  static async getAllPaginatedData(baseUrl, headers) {
    let allData = [];
    let nextLink = `${baseUrl}/Invoices?$orderby=CreationDate desc`;

    while (nextLink) {
      try {
        const response = await axios.get(nextLink, { headers });
        allData = [...allData, ...response.data.value];
        nextLink = response.data["odata.nextLink"];

        if (!nextLink) break;

        if (nextLink.startsWith("Invoices")) {
          nextLink = `${baseUrl}/${nextLink}`;
        }
      } catch (error) {
        throw new Error(`Pagination error: ${error.message}`);
      }
    }

    return allData;
  }

  static async syncInvoices(req, res) {
    try {
      const { year } = req.params;

      if (!year || isNaN(year)) {
        return res.status(400).json({
          error: "Valid year parameter is required",
        });
      }

      const headers = {
        Cookie: req.headers.cookie,
      };

      // Stats to track progress
      let created = 0;
      let skipped = 0;
      let errors = [];
      let totalProcessed = 0;

      // Modify the URL to include year filter
      const startDate = new Date(year, 0, 1).toISOString().split("T")[0];
      const endDate = new Date(year, 11, 31).toISOString().split("T")[0];
      let nextLink = `${process.env.BASE_URL}/Invoices?$filter=DocDate ge '${startDate}' and DocDate le '${endDate}'&$orderby=CreationDate`;

      while (nextLink) {
        try {
          console.log(`Fetching data from: ${nextLink}`);
          const response = await axios.get(nextLink, { headers });
          const currentBatch = response.data.value;
          console.log(`Processing batch of ${currentBatch.length} invoices`);

          // Process current batch
          for (const invoice of currentBatch) {
            try {
              const existingInvoice = await Invoice.findOne({
                DocEntry: invoice.DocEntry,
              });

              if (!existingInvoice) {
                const { paymentMethod, isPOS, isDelivery } =
                  InvoiceController.determinePaymentMethod(invoice);

                const invoiceWithTracking = {
                  ...invoice,
                  dateStored: new Date(),
                  verified: false,
                  tag: "None",
                  paymentMethod,
                  isPOS,
                  isDelivery,
                };

                await Invoice.create(invoiceWithTracking);
                created++;
              } else {
                skipped++;
              }
              totalProcessed++;

              // Log progress every 100 invoices
              if (totalProcessed % 100 === 0) {
                console.log(
                  `Progress: Processed ${totalProcessed} invoices. Created: ${created}, Skipped: ${skipped}, Errors: ${errors.length}`
                );
              }
            } catch (error) {
              errors.push({ DocEntry: invoice.DocEntry, error: error.message });
              console.error(
                `Error processing invoice ${invoice.DocEntry}:`,
                error
              );
            }
          }

          // Get next link and clear current batch from memory
          nextLink = response.data["odata.nextLink"];
          console.log("Next link:", nextLink);

          if (nextLink && nextLink.startsWith("Invoices")) {
            nextLink = `${process.env.BASE_URL}/${nextLink}`;
          }

          // Force garbage collection of the response data
          response.data = null;
        } catch (error) {
          console.error("Error in batch processing:", error);
          errors.push({ batch: nextLink, error: error.message });
          break; // Stop processing on batch error
        }
      }

      res.json({
        message: `Sync completed for year ${year}`,
        stats: {
          year,
          totalProcessed,
          created,
          skipped,
          errors: errors.length,
        },
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error syncing invoices:", error);
      res.status(500).json({ error: "Failed to sync invoices" });
    }
  }

  static async getInvoicesByDate(req, res) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: "Both startDate and endDate are required",
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          error: "Invalid date format. Please use YYYY-MM-DD format",
        });
      }

      const invoices = await Invoice.find({
        DocDate: {
          $gte: start,
          $lte: end,
        },
      }).sort({ DocDate: -1 });

      res.json({
        dateRange: { start, end },
        count: invoices.length,
        invoices,
      });
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  }

  static async getPaymentMethodStats(req, res) {
    try {
      const { year } = req.params;

      if (!year || isNaN(year)) {
        return res.status(400).json({
          error: "Valid year parameter is required",
        });
      }

      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

      const stats = await Invoice.aggregate([
        {
          $match: {
            CreationDate: {
              $gte: startDate,
              $lte: endDate,
            },
          },
        },
        {
          $group: {
            _id: "$paymentMethod",
            count: { $sum: 1 },
            total: { $sum: "$DocTotal" },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      res.json({
        year,
        stats,
      });
    } catch (error) {
      console.error("Error fetching payment stats:", error);
      res.status(500).json({ error: "Failed to fetch payment statistics" });
    }
  }

  static async updateInvoiceTag(req, res) {
    try {
      const { DocEntry } = req.params;
      const { tag } = req.body;
      console.log("Tag:", tag);
      console.log("DocEntry:", DocEntry);

      if (
        !["Own Company", "Cash and Carry", "Delivery", "None"].includes(tag)
      ) {
        return res.status(400).json({
          error: "Invalid tag value",
        });
      }

      const invoice = await Invoice.findOneAndUpdate(
        { DocEntry },
        { tag },
        { new: true }
      );

      if (!invoice) {
        return res.status(404).json({
          error: "Invoice not found",
        });
      }

      res.json(invoice);
    } catch (error) {
      console.error("Error updating invoice tag:", error);
      res.status(500).json({ error: "Failed to update invoice tag" });
    }
  }

  static async toggleVerified(req, res) {
    try {
      const { DocEntry } = req.params;

      const invoice = await Invoice.findOne({ DocEntry });

      if (!invoice) {
        return res.status(404).json({
          error: "Invoice not found",
        });
      }

      invoice.verified = !invoice.verified;
      await invoice.save();

      res.json(invoice);
    } catch (error) {
      console.error("Error toggling invoice verification:", error);
      res.status(500).json({ error: "Failed to toggle invoice verification" });
    }
  }

  static async getInvoiceStats(req, res) {
    try {
      const { year, month } = req.query;

      let dateMatch = {};

      if (year && month) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);
        dateMatch = {
          CreationDate: {
            $gte: startDate,
            $lte: endDate,
          },
        };
      } else if (year) {
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
        dateMatch = {
          CreationDate: {
            $gte: startDate,
            $lte: endDate,
          },
        };
      }

      const stats = await Invoice.aggregate([
        {
          $match: dateMatch,
        },
        {
          $group: {
            _id: {
              paymentMethod: "$paymentMethod",
              isPOS: "$isPOS",
              isDelivery: "$isDelivery",
            },
            count: { $sum: 1 },
            total: { $sum: "$DocTotal" },
            verified: {
              $sum: { $cond: ["$verified", 1, 0] },
            },
            unverified: {
              $sum: { $cond: ["$verified", 0, 1] },
            },
          },
        },
        {
          $sort: {
            "_id.paymentMethod": 1,
          },
        },
      ]);

      res.json({
        period: {
          year,
          month: month ? parseInt(month) : undefined,
        },
        stats,
      });
    } catch (error) {
      console.error("Error fetching invoice statistics:", error);
      res.status(500).json({ error: "Failed to fetch invoice statistics" });
    }
  }
  // Add to InvoiceController class
  static async getCustomerStats(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const sortField = req.query.sortField || "customerName";
      const sortOrder = parseInt(req.query.sortOrder) || 1;
      const search = req.query.search || "";

      const skip = (page - 1) * limit;

      // Build search query
      let searchQuery = {};
      if (search) {
        searchQuery = {
          CardName: { $regex: search, $options: "i" },
        };
      }

      // Aggregate pipeline for customer stats
      const pipeline = [
        { $match: searchQuery },
        {
          $group: {
            _id: "$CardName",
            customerName: { $first: "$CardName" },
            tag: { $first: "$tag" },
            totalSales: { $sum: "$DocTotal" },
            paidInvoiceCount: {
              $sum: {
                $cond: [{ $eq: ["$PaidToDate", "$DocTotal"] }, 1, 0],
              },
            },
            unpaidInvoiceCount: {
              $sum: {
                $cond: [{ $lt: ["$PaidToDate", "$DocTotal"] }, 1, 0],
              },
            },
          },
        },
        { $sort: { [sortField]: sortOrder } },
        {
          $facet: {
            metadata: [{ $count: "totalCount" }],
            data: [{ $skip: skip }, { $limit: limit }],
          },
        },
      ];

      const result = await Invoice.aggregate(pipeline);

      const totalCount = result[0].metadata[0]?.totalCount || 0;
      const data = result[0].data;

      res.json({
        data,
        metadata: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          limit,
        },
      });
    } catch (error) {
      console.error("Error fetching customer stats:", error);
      res.status(500).json({ error: "Failed to fetch customer statistics" });
    }
  }

  static async getCustomerInvoices(req, res) {
    try {
      const { customerName, status } = req.query;

      if (!customerName) {
        return res.status(400).json({
          error: "Customer name is required",
        });
      }

      let query = { CardName: customerName };

      // Add status filter if provided
      if (status === "paid") {
        query.$expr = { $eq: ["$PaidToDate", "$DocTotal"] };
      } else if (status === "unpaid") {
        query.$expr = { $lt: ["$PaidToDate", "$DocTotal"] };
      }

      const invoices = await Invoice.find(query).sort({ DocDate: -1 }).lean();

      res.json(invoices);
    } catch (error) {
      console.error("Error fetching customer invoices:", error);
      res.status(500).json({ error: "Failed to fetch customer invoices" });
    }
  }
  // In InvoiceController.js, add this method:
  static async getDashboardStats(req, res) {
    try {
      const { startDate, endDate } = req.query;

      // Base match condition for date filtering
      let dateMatch = {};
      if (startDate && endDate) {
        dateMatch = {
          DocDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        };
      }

      // Today's sales match
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      // Today's sales pipeline
      const todaySalesPipeline = [
        {
          $match: {
            DocDate: {
              $gte: todayStart,
              $lte: todayEnd,
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$DocTotal" },
          },
        },
      ];

      // Main pipeline with date filtering
      const mainPipeline = [
        {
          $match: dateMatch,
        },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  totalSales: { $sum: "$DocTotal" },
                  creditSales: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ["$isPOS", false] },
                            { $eq: ["$isDelivery", false] },
                          ],
                        },
                        "$DocTotal",
                        0,
                      ],
                    },
                  },
                  cashSales: {
                    $sum: {
                      $cond: [{ $eq: ["$isPOS", true] }, "$DocTotal", 0],
                    },
                  },
                  deliverySales: {
                    $sum: {
                      $cond: [{ $eq: ["$isDelivery", true] }, "$DocTotal", 0],
                    },
                  },
                },
              },
            ],
            recentInvoices: [
              { $sort: { DocDate: -1 } },
              { $limit: 4 },
              {
                $project: {
                  DocNum: 1,
                  DocDate: 1,
                  DocTotal: 1,
                  CardName: 1,
                  paymentMethod: 1,
                  PaidToDate: 1,
                  status: {
                    $cond: [
                      { $eq: ["$DocTotal", "$PaidToDate"] },
                      "Paid",
                      {
                        $cond: [
                          { $gt: ["$PaidToDate", 0] },
                          "Partial",
                          "Pending",
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            monthlyTrend: [
              {
                $group: {
                  _id: {
                    year: { $year: "$DocDate" },
                    month: { $month: "$DocDate" },
                  },
                  creditSales: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ["$isPOS", false] },
                            { $eq: ["$isDelivery", false] },
                          ],
                        },
                        "$DocTotal",
                        0,
                      ],
                    },
                  },
                  cashSales: {
                    $sum: {
                      $cond: [{ $eq: ["$isPOS", true] }, "$DocTotal", 0],
                    },
                  },
                },
              },
              {
                $sort: {
                  "_id.year": 1,
                  "_id.month": 1,
                },
              },
            ],
            topCustomers: [
              {
                $group: {
                  _id: "$CardName",
                  totalSales: { $sum: "$DocTotal" },
                },
              },
              { $sort: { totalSales: -1 } },
              { $limit: 5 },
            ],
          },
        },
      ];

      // Execute both pipelines
      const [todaySalesResult, mainStatsResult] = await Promise.all([
        Invoice.aggregate(todaySalesPipeline),
        Invoice.aggregate(mainPipeline),
      ]);

      const mainStats = mainStatsResult[0];

      res.json({
        todaysSales: todaySalesResult[0]?.total || 0,
        totals: mainStats.totals[0] || {
          totalSales: 0,
          creditSales: 0,
          cashSales: 0,
          deliverySales: 0,
        },
        recentInvoices: mainStats.recentInvoices || [],
        monthlyTrend:
          mainStats.monthlyTrend.map((item) => ({
            month: `${item._id.year}-${String(item._id.month).padStart(
              2,
              "0"
            )}`,
            creditSales: item.creditSales,
            cashSales: item.cashSales,
          })) || [],
        topCustomers:
          mainStats.topCustomers.map((customer) => ({
            customerName: customer._id,
            totalSales: customer.totalSales,
          })) || [],
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard statistics" });
    }
  }

  static async updateCustomerTag(req, res) {
    try {
      const { customerName } = req.body;
      const { tag } = req.body;

      if (!customerName || !tag) {
        return res.status(400).json({
          error: "Customer name and tag are required",
        });
      }

      const result = await Invoice.updateMany(
        { CardName: customerName },
        { tag }
      );

      res.json({
        message: "Tags updated successfully",
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("Error updating customer tags:", error);
      res.status(500).json({ error: "Failed to update customer tags" });
    }
  }

  static async updatePOSPaymentMethods(req, res) {
    try {
      // Get POS invoices from 2024
      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-31T23:59:59.999Z");

      const posInvoices = await Invoice.find({
        $and: [
          {
            $or: [
              { CardCode: "C9999" },
              { paymentMethod: { $regex: /POS/i } },
              { U_EPOSNo: { $ne: null } },
              { isPOS: true },
            ],
          },
          {
            DocDate: {
              $gte: startDate,
              $lte: endDate,
            },
          },
        ],
      });

      console.log(`Found ${posInvoices.length} POS invoices to process`);

      const stats = {
        total: posInvoices.length,
        updated: 0,
        skipped: 0,
        errors: [],
      };

      // Process each POS invoice
      for (const invoice of posInvoices) {
        try {
          // Find matching payment using DocNum
          const payment = await Payment.findOne({ DocNum: invoice.DocNum });
          console.log(`Processing invoice ${invoice.DocNum}`);
          if (!payment) {
            console.log(`No payment found for invoice ${invoice.DocNum}`);
            stats.skipped++;
            continue;
          }

          // Determine payment method based on non-zero payment field
          let newPaymentMethod = "Unknown";
          if (payment.CashSum > 0) {
            newPaymentMethod = "POS-Cash";
          } else if (payment.CheckSum > 0) {
            newPaymentMethod = "POS-Cheque";
          } else if (payment.CreditSum > 0) {
            newPaymentMethod = "POS-Credit";
          }

          // Only update if payment method is different
          if (invoice.paymentMethod !== newPaymentMethod) {
            await Invoice.updateOne(
              { _id: invoice._id },
              { $set: { paymentMethod: newPaymentMethod } }
            );
            stats.updated++;
            console.log(
              `Updated invoice ${invoice.DocNum} to ${newPaymentMethod}`
            );
          } else {
            stats.skipped++;
          }
        } catch (error) {
          console.error(`Error processing invoice ${invoice.DocNum}:`, error);
          stats.errors.push({
            docNum: invoice.DocNum,
            error: error.message,
          });
        }
      }

      res.json({
        message: "POS invoice payment methods update completed",
        stats: {
          totalProcessed: stats.total,
          updated: stats.updated,
          skipped: stats.skipped,
          errors: stats.errors.length,
        },
        errors: stats.errors.length > 0 ? stats.errors : undefined,
      });
    } catch (error) {
      console.error("Error updating POS payment methods:", error);
      res.status(500).json({ error: "Failed to update POS payment methods" });
    }
  }
}

module.exports = InvoiceController;
