# Trade Journal

A modern, feature-rich trading journal application built with Angular 21, designed to help traders track, analyze, and improve their trading performance.

## ✨ Features

### 📊 Dashboard
- **Performance Metrics**: Total P&L, Win Rate, Total Trades, Best Trade
- **Equity Curve**: Visual representation of cumulative P&L over time
- **Win/Loss Distribution**: Doughnut chart showing trade outcomes
- **Recent Trades**: Quick view of your latest trading activity

### 📝 Trade Management
- **Add Trades**: Comprehensive form with validation and real-time P&L calculation
- **Trade List**: Searchable, filterable, and sortable table of all trades
- **Multiple Asset Types**: Support for stocks, options, forex, futures, and crypto
- **Long/Short Positions**: Track both bullish and bearish trades

### 📈 Analytics
- Automatic P&L calculations (gross, net, percentage)
- Win rate tracking
- Average win/loss metrics
- Largest win/loss identification

### 🎨 User Experience
- Clean, modern UI with Tailwind CSS
- Full dark mode support
- Responsive design (mobile-friendly)
- Smooth transitions and hover effects

## 🚀 Tech Stack

- **Framework**: Angular 21 (Standalone Components)
- **State Management**: Angular Signals
- **Styling**: Tailwind CSS
- **Charts**: Chart.js
- **Language**: TypeScript
- **Build Tool**: Angular CLI with Vite
- **Testing**: Vitest (configured)

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/trade-journal.git
   cd trade-journal
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

4. **Open your browser**
   Navigate to `http://localhost:4200/`

## 🔐 Demo Credentials

The app uses mock authentication. Use these credentials to log in:

- **Email**: `demo@tradezella.com`
- **Password**: `demo123`

Alternative account:
- **Email**: `trader@example.com`
- **Password**: `password`

## 📁 Project Structure

```
src/app/
├── core/
│   ├── guards/         # Route guards (auth)
│   ├── models/         # TypeScript interfaces (Trade, User)
│   └── services/       # Business logic (TradeService, AuthService)
├── features/
│   ├── auth/           # Login component
│   ├── dashboard/      # Analytics dashboard
│   ├── journal/        # Trade list and entry forms
│   └── layout/         # App shell (header, sidebar, main layout)
└── shared/             # Shared components (future)
```

## 🛠️ Development

### Available Scripts

- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run unit tests
- `npm run watch` - Build in watch mode

### Code Scaffolding

Generate a new component:
```bash
ng generate component component-name
```

Generate a service:
```bash
ng generate service service-name
```

## 🎯 Roadmap

- [ ] Trade editing functionality
- [ ] Trade detail view/modal
- [ ] Screenshot upload and preview
- [ ] Export/Import (CSV, JSON)
- [ ] Advanced analytics (win rate by setup, time-based analysis)
- [ ] Backend integration (replace localStorage)
- [ ] User registration and real authentication

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- Built with [Angular](https://angular.dev/)
- Charts powered by [Chart.js](https://www.chartjs.org/)
- Styled with [Tailwind CSS](https://tailwindcss.com/)
