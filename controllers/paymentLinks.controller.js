// controllers/paymentController.js
const XLSX = require('xlsx');
const PaymentLink = require('../models/paymentLinks.model');

exports.uploadPayments = async (req, res) => {
  try {
      if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
      }

      // Read the Excel file with date parsing enabled
      const workbook = XLSX.read(req.file.buffer, { 
          type: 'buffer',
          cellDates: true  // This will automatically convert Excel dates to JS Date objects
      });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet);

      // Batch processing setup
      const batchSize = 1000;
      const paymentLinks = [];
      let successCount = 0;
      let errorCount = 0;

      // Process each row
      for (const row of data) {
          try {
              const paymentLink = {
                  paymentNumber: parseInt(row.PAYMENTNO),
                  invoiceNumber: parseInt(row.INVOICENO),
                  paymentAmount: parseFloat(row.PAIDAMT),
                  invoiceAmount: parseFloat(row.INVAMT),
                  paymentDate: new Date(row.PAYDATE),
                  invoiceDate: new Date(row.INVDATE)
              };

              // Validate the data
              if (!isNaN(paymentLink.paymentNumber) && 
                  !isNaN(paymentLink.invoiceNumber) && 
                  !isNaN(paymentLink.paymentAmount) && 
                  !isNaN(paymentLink.invoiceAmount) && 
                  paymentLink.paymentDate instanceof Date && 
                  paymentLink.invoiceDate instanceof Date) {
                  
                  paymentLinks.push(paymentLink);
                  successCount++;
              } else {
                  console.error(`Invalid data in row:`, row);
                  errorCount++;
              }

              // Process in batches
              if (paymentLinks.length === batchSize) {
                  await PaymentLink.insertMany(paymentLinks);
                  paymentLinks.length = 0; // Clear the array
              }
          } catch (error) {
              console.error(`Error processing row:`, row, error);
              errorCount++;
          }
      }

      // Insert any remaining records
      if (paymentLinks.length > 0) {
          await PaymentLink.insertMany(paymentLinks);
      }

      res.status(200).json({
          message: 'File processed successfully',
          totalProcessed: successCount + errorCount,
          successCount,
          errorCount
      });

  } catch (error) {
      console.error('Error processing file:', error);
      res.status(500).json({
          error: 'Error processing file',
          details: error.message
      });
  }
};

