# Tent Studio 3D Configurator

An interactive 3D tent configurator that allows customers to customize tent dimensions and options, preview their tent in 3D, calculate dynamic pricing, generate PDF quotations, and proceed to Shopify checkout.

## Live Demo

- **Frontend:** https://tent-studio-configurator.vercel.app/
- **Backend:** https://tent-studio-configurator.onrender.com
- **GitHub:** https://github.com/HimanshiRajput78/tent-studio-configurator

## Project Overview

Tent Studio is a web-based application designed to simplify tent customization. Customers can select available tent configurations, view changes in a 3D preview, calculate the total price, and generate a quotation.

### Key Features

- Interactive 3D tent visualization
- Tent size and configuration selection
- Frame and side-wall customization
- Printing and half-wall options
- Dynamic price calculation
- PDF quotation generation
- Shopify Draft Order integration
- Checkout URL generation

## Technologies Used

### Frontend
- React.js
- TypeScript
- Vite
- Three.js
- HTML5 and CSS3

### Backend
- Node.js
- Express.js
- TypeScript
- Shopify Admin API

### Deployment and Tools
- Vercel
- Render
- GitHub
- Shopify Development Store

## Application Architecture

The project uses a frontend-backend architecture.

**Frontend (Vercel)**
- Displays the configurator interface and 3D tent model.
- Handles customer configuration selections.
- Displays calculated pricing.
- Generates PDF quotations.
- Sends API requests to the backend.

**Backend (Render)**
- Provides API endpoints.
- Validates configuration and customer details.
- Calculates and processes order information.
- Communicates with Shopify through the Admin API.
- Creates Shopify Draft Orders and returns checkout information.

## API Integration

The backend provides the following endpoints:

### Health Check

`GET /api/health`

Checks whether the backend server is running.

### Shopify Draft Order

`POST /api/shopify/draft-order`

Accepts customer and tent configuration details, processes the request, and creates a Shopify Draft Order.

## Shopify Integration

The application integrates with Shopify using the Shopify Admin API.

The integration supports:

- Creating Draft Orders
- Sending customized tent details
- Passing configuration and pricing information
- Generating a checkout URL

The Draft Order and checkout flow was tested using a Shopify development store.

## Dynamic Pricing Logic

The application calculates pricing according to the selected tent configuration.

Pricing factors include:

- Tent dimensions
- Frame type
- Side walls
- Printing options
- Half-wall options

The final price is calculated from the selected configuration and displayed in the configurator.

## PDF Generation

The application provides PDF quotation generation using the selected tent configuration and pricing details.

The quotation allows customers to review and share their customized tent details.

## Installation and Setup

### Prerequisites

- Node.js
- npm
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/HimanshiRajput78/tent-studio-configurator.git
cd tent-studio-configurator
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Install Backend Dependencies

```bash
cd server
npm install
```

### 4. Configure Environment Variables

Configure the required environment variables for the frontend and backend.

Example:

```env
VITE_API_BASE_URL=http://localhost:5000

SHOPIFY_SHOP=your-shop-name
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
SHOPIFY_API_VERSION=your-api-version
```

Use your own Shopify credentials. Never commit actual credentials or `.env` files to GitHub.

### 5. Start the Backend

From the `server` directory:

```bash
npm run dev
```

Backend URL: `http://localhost:5000`

### 6. Start the Frontend

Open another terminal in the project root:

```bash
npm run dev
```

Frontend URL: `http://localhost:5173`

## Deployment

- Frontend is deployed on Vercel.
- Backend is deployed on Render.
- Production environment variables are configured on the respective platforms.

## Author

**Himanshi Rajput**

GitHub: https://github.com/HimanshiRajput78