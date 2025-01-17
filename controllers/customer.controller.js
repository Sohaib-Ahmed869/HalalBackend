const xlsx = require('xlsx');
const mongoose = require('mongoose');
const Customer = require('../models/customer.model'); // Adjust path as needed

// Function to generate a simple email from business name


// Function to import data
async function importCustomers() {
    try {

        // Read Excel file
        const workbook = xlsx.readFile('20250117T002950.943-Customers List.xlsx');
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        // Counter for tracking progress
        let succeeded = 0;
        let failed = 0;

        // Process each row
        for (const row of data) {
            try {
                const customerData = {
                    CardCode: row['BP Code'],
                    CardName: row['BP Name'],
                    Email: row['E-Mail']
                };

               
                await Customer.findOneAndUpdate(
                    { CardCode: customerData.CardCode },
                    customerData,
                    { upsert: true, new: true }
                );
                console.log('Customer data:', customerData);
                succeeded++;
                if (succeeded % 100 === 0) {
                    console.log(`Processed ${succeeded} records...`);
                }
            } catch (err) {
                failed++;
                console.error(`Error processing row:`, row, err.message);
            }
        }

        console.log(`Import completed:`);
        console.log(`Successfully processed: ${succeeded} records`);
        console.log(`Failed: ${failed} records`);

    } catch (err) {
        console.error('Import failed:', err);
    } 
}

const importCustomer = async (req, res) => {
    try {
        await importCustomers();
        res.status(200).send('Import completed');
    } catch (err) {
        console.error('Import failed:', err);
        res.status(500).send('Import failed');
    }
};

module.exports = {
    importCustomer
};