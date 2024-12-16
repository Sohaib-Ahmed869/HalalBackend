const axios = require('axios');

class InvoiceController {
    static async getAllPaginatedData(baseUrl, headers) {
        let allData = [];
        let nextLink = `${baseUrl}/Invoices?$orderby=CreationDate desc`;
        
        while (nextLink) {
            try {
                const response = await axios.get(nextLink, { headers });
                allData = [...allData, ...response.data.value];
                
                // Get the next link from the response
                nextLink = response.data['@odata.nextLink'];
                
                // If no next link, break the loop
                if (!nextLink) break;
                
                // If nextLink is a relative URL, make it absolute
                if (nextLink.startsWith('Invoices')) {
                    nextLink = `${baseUrl}/${nextLink}`;
                }
            } catch (error) {
                throw new Error(`Pagination error: ${error.message}`);
            }
        }
        
        return allData;
    }

    static async getInvoices(req, res) {
        try {
            const headers = {
                Cookie: req.headers.cookie
            };
            
            const allInvoices = await InvoiceController.getAllPaginatedData(
                process.env.BASE_URL,
                headers
            );
            
            res.json(allInvoices);
        } catch (error) {
            console.error('Error fetching invoices:', error.response?.data || error.message);
            res.status(500).json({ error: 'Failed to fetch invoices' });
        }
    }

    static async getInvoicesByDate(req, res) {
        try {
            const { startDate, endDate } = req.query;

            // Validate date parameters
            if (!startDate || !endDate) {
                return res.status(400).json({
                    error: "Both startDate and endDate are required",
                });
            }

            // Create Date objects for comparison
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return res.status(400).json({
                    error: "Invalid date format. Please use YYYY-MM-DD format",
                });
            }

            const headers = {
                Cookie: req.headers.cookie
            };
            
            // Fetch all paginated invoices
            const allInvoices = await InvoiceController.getAllPaginatedData(
                process.env.BASE_URL,
                headers
            );

            // Filter invoices by date
            const filteredInvoices = allInvoices.filter(invoice => {
                const invoiceDate = new Date(invoice.CreationDate);
                return invoiceDate >= start && invoiceDate <= end;
            });

            // Log for debugging
            console.log('Date range:', { start, end });
            console.log('Total invoices:', allInvoices.length);
            console.log('Filtered invoices:', filteredInvoices.length);

            res.json(filteredInvoices);
        } catch (error) {
            console.error('Error fetching invoices:', error.response?.data || error.message);
            res.status(500).json({ error: 'Failed to fetch invoices' });
        }
    }
}

module.exports = InvoiceController;