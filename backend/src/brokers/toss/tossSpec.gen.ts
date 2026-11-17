// ⚠ 자동 생성 파일 — 직접 고치지 말 것. `npm run spec:types`가 backend/spec/snapshots/toss.json에서 만든다.
// 증권사 공식 명세 중 MyStock이 쓰는 엔드포인트의 구조만 담았다(scripts/spec-watch.cjs).
/* eslint-disable */
export type paths = {
    "/api/v1/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getAccounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/buying-power": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getBuyingPower"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/candles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getCandles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exchange-rate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getExchangeRate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/holdings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getHoldings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/market-calendar/KR": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getKrMarketCalendar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/market-calendar/US": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getUsMarketCalendar"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/market-indicators/{symbol}/candles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getMarketIndicatorCandles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getPrices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sectors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listSectors"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sectors/{sectorId}/etfs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getSectorEtfs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sectors/{sectorId}/stocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getSectorStocks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getStocks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stocks/{symbol}/warnings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getStockWarnings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/transactions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getTransactions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/oauth2/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["issueOAuth2Token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        Account: {
            accountNo: string;
            /** Format: int64 */
            accountSeq: number;
            /** @enum {string} */
            accountType: "BROKERAGE" | "OVERSEAS_DERIVATIVES" | "PENSION_SAVINGS" | "RESHORING_INVESTMENT";
        };
        AfterMarketSession: {
            /** Format: date-time */
            endTime: string;
            singlePriceAuctionEndTime?: string | null;
            /** Format: date-time */
            startTime: string;
        };
        ApiResponse: {
            result: unknown;
        };
        /** @enum {string} */
        AssetClass: "STOCK" | "BOND" | "OPTION";
        BuyingPowerResponse: {
            /** Format: decimal */
            cashBuyingPower: string;
            currency: components["schemas"]["Currency"];
        };
        Candle: {
            /** Format: decimal */
            closePrice: string;
            currency: components["schemas"]["Currency"];
            /** Format: decimal */
            highPrice: string;
            /** Format: decimal */
            lowPrice: string;
            /** Format: decimal */
            openPrice: string;
            /** Format: date-time */
            timestamp: string;
            /** Format: decimal */
            volume: string;
        };
        CandlePageResponse: {
            candles: components["schemas"]["Candle"][];
            /** Format: date-time */
            nextBefore?: string | null;
        };
        Cost: {
            /** Format: decimal */
            commission: string;
            /** Format: decimal */
            tax?: string | null;
        };
        /** @enum {string} */
        Currency: "KRW" | "USD";
        DailyProfitLoss: {
            /** Format: decimal */
            amount: string;
            /** Format: decimal */
            rate: string;
        };
        ExchangeRateResponse: {
            baseCurrency: components["schemas"]["Currency"];
            /** Format: decimal */
            basisPoint: string;
            /** Format: decimal */
            midRate: string;
            quoteCurrency: components["schemas"]["Currency"];
            /** Format: decimal */
            rate: string;
            /** @enum {string} */
            rateChangeType: "UP" | "EQUAL" | "DOWN";
            /** Format: date-time */
            validFrom: string;
            /** Format: date-time */
            validUntil: string;
        };
        HoldingsItem: {
            /** Format: decimal */
            averagePurchasePrice: string;
            cost: components["schemas"]["Cost"];
            currency: components["schemas"]["Currency"];
            dailyProfitLoss: components["schemas"]["DailyProfitLoss"];
            /** Format: decimal */
            lastPrice: string;
            marketCountry: components["schemas"]["MarketCountry"];
            marketValue: components["schemas"]["MarketValue"];
            name: string;
            profitLoss: components["schemas"]["ProfitLoss"];
            /** Format: decimal */
            quantity: string;
            symbol: string;
        };
        HoldingsOverview: {
            dailyProfitLoss: components["schemas"]["OverviewDailyProfitLoss"];
            items: components["schemas"]["HoldingsItem"][];
            marketValue: components["schemas"]["OverviewMarketValue"];
            profitLoss: components["schemas"]["OverviewProfitLoss"];
            totalPurchaseAmount: components["schemas"]["Price"];
        };
        IntegratedHour: {
            afterMarket?: components["schemas"]["AfterMarketSession"] | null;
            preMarket?: components["schemas"]["PreMarketSession"] | null;
            regularMarket?: components["schemas"]["RegularMarketSession"] | null;
        };
        KrMarketCalendarResponse: {
            nextBusinessDay: components["schemas"]["KrMarketDay"];
            previousBusinessDay: components["schemas"]["KrMarketDay"];
            today: components["schemas"]["KrMarketDay"];
        };
        KrMarketDay: {
            /** Format: date */
            date: string;
            integrated?: components["schemas"]["IntegratedHour"] | null;
        };
        KrMarketDetail: {
            krxTradingSuspended: boolean;
            liquidationTrading: boolean;
            nxtSupported: boolean;
            nxtTradingSuspended?: boolean | null;
        };
        /** @enum {string} */
        MarketCountry: "KR" | "US";
        MarketIndicatorCandle: {
            /** Format: decimal */
            closePrice: string;
            /** Format: decimal */
            highPrice: string;
            /** Format: decimal */
            lowPrice: string;
            /** Format: decimal */
            openPrice: string;
            /** Format: date-time */
            timestamp: string;
            /** Format: decimal */
            volume: string;
        };
        MarketIndicatorCandlePageResponse: {
            candles: components["schemas"]["MarketIndicatorCandle"][];
            /** Format: date-time */
            nextBefore?: string | null;
        };
        MarketValue: {
            /** Format: decimal */
            amount: string;
            /** Format: decimal */
            amountAfterCost: string;
            /** Format: decimal */
            purchaseAmount: string;
        };
        OAuth2TokenRequest: {
            client_id: string;
            /** Format: password */
            client_secret: string;
            /** @enum {string} */
            grant_type: "client_credentials";
        };
        OAuth2TokenResponse: {
            access_token: string;
            /** Format: int64 */
            expires_in: number;
            /** @enum {string} */
            token_type: "Bearer";
        };
        Order: {
            /** Format: date-time */
            canceledAt?: string | null;
            currency: components["schemas"]["Currency"];
            execution: components["schemas"]["OrderExecution"];
            /** Format: decimal */
            orderAmount?: string | null;
            /** Format: date-time */
            orderedAt: string;
            orderId: string;
            /** @enum {string} */
            orderType: "LIMIT" | "MARKET";
            /** Format: decimal */
            price?: string | null;
            /** Format: decimal */
            quantity: string;
            /** @enum {string} */
            side: "BUY" | "SELL";
            status: components["schemas"]["OrderStatus"];
            symbol: string;
            /** @enum {string} */
            timeInForce: "DAY" | "CLS" | "OPG";
        };
        OrderExecution: {
            /** Format: decimal */
            averageFilledPrice: string | null;
            /** Format: decimal */
            commission: string | null;
            /** Format: decimal */
            filledAmount: string | null;
            /** Format: date-time */
            filledAt: string | null;
            /** Format: decimal */
            filledQuantity: string;
            /** Format: date */
            settlementDate: string | null;
            /** Format: decimal */
            tax: string | null;
        };
        /** @enum {string} */
        OrderStatus: "PENDING" | "PENDING_CANCEL" | "PENDING_REPLACE" | "PARTIAL_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "CANCEL_REJECTED" | "REPLACE_REJECTED" | "REPLACED";
        OverviewDailyProfitLoss: {
            amount: components["schemas"]["Price"];
            /** Format: decimal */
            rate: string;
        };
        OverviewMarketValue: {
            amount: components["schemas"]["Price"];
            amountAfterCost: components["schemas"]["Price"];
        };
        OverviewProfitLoss: {
            amount: components["schemas"]["Price"];
            amountAfterCost: components["schemas"]["Price"];
            /** Format: decimal */
            rate: string;
            /** Format: decimal */
            rateAfterCost: string;
        };
        PaginatedOrderResponse: {
            hasNext: boolean;
            nextCursor: string | null;
            orders: components["schemas"]["Order"][];
        };
        PaginatedTransactionResponse: {
            hasNext: boolean;
            nextCursor: string | null;
            transactions: components["schemas"]["Transaction"][];
        };
        PreMarketSession: {
            /** Format: date-time */
            endTime: string;
            singlePriceAuctionStartTime?: string | null;
            /** Format: date-time */
            startTime: string;
        };
        Price: {
            /** Format: decimal */
            krw: string;
            /** Format: decimal */
            usd?: string | null;
        };
        PriceResponse: {
            currency: components["schemas"]["Currency"];
            /** Format: decimal */
            lastPrice: string;
            symbol: string;
            /** Format: date-time */
            timestamp?: string | null;
        };
        ProfitLoss: {
            /** Format: decimal */
            amount: string;
            /** Format: decimal */
            amountAfterCost: string;
            /** Format: decimal */
            rate: string;
            /** Format: decimal */
            rateAfterCost: string;
        };
        RegularMarketSession: {
            /** Format: date-time */
            endTime: string;
            singlePriceAuctionStartTime?: string | null;
            /** Format: date-time */
            startTime: string;
        };
        Sector: {
            depth: number;
            name: string;
            parentSectorId: string | null;
            sectorId: string;
        };
        SectorEtf: {
            name: string;
            symbol: string;
        };
        SectorEtfsResponse: {
            etfs: components["schemas"]["SectorEtf"][];
        };
        SectorsResponse: {
            sectors: components["schemas"]["Sector"][];
        };
        SectorStock: {
            currency: components["schemas"]["Currency"];
            /** Format: decimal */
            marketCapitalization: string | null;
            name: string;
            symbol: string;
            /** Format: decimal */
            tradingAmount: string | null;
            /** Format: decimal */
            volume: string | null;
        };
        SectorStocksResponse: {
            stocks: components["schemas"]["SectorStock"][];
        };
        StockInfo: {
            currency: components["schemas"]["Currency"];
            /** Format: date */
            delistDate?: string | null;
            englishName: string;
            isCommonShare: boolean;
            isinCode: string;
            koreanMarketDetail?: components["schemas"]["KrMarketDetail"] | null;
            /** Format: decimal */
            leverageFactor?: string | null;
            /** Format: date */
            listDate?: string | null;
            /** @enum {string} */
            market: "KOSPI" | "KOSDAQ" | "NYSE" | "NASDAQ" | "AMEX" | "KR_ETC" | "US_ETC";
            name: string;
            /** @enum {string} */
            securityType: "STOCK" | "FOREIGN_STOCK" | "DEPOSITARY_RECEIPT" | "INFRASTRUCTURE_FUND" | "REIT" | "ETF" | "FOREIGN_ETF" | "ETN" | "STOCK_WARRANTS";
            /** Format: decimal */
            sharesOutstanding: string;
            /** @enum {string} */
            status: "SCHEDULED" | "ACTIVE" | "DELISTED";
            symbol: string;
        };
        StockWarning: {
            /** Format: date */
            endDate?: string | null;
            exchange?: string | null;
            /** Format: date */
            startDate?: string | null;
            /** @enum {string} */
            warningType: "LIQUIDATION_TRADING" | "OVERHEATED" | "INVESTMENT_WARNING" | "INVESTMENT_RISK" | "VI_STATIC_AND_DYNAMIC" | "VI_STATIC" | "VI_DYNAMIC" | "STOCK_WARRANTS";
        };
        Transaction: {
            /** Format: decimal */
            amount: string | null;
            assetClass: components["schemas"]["AssetClass"] | null;
            /** Format: decimal */
            commission: string;
            currency: components["schemas"]["Currency"];
            /** Format: decimal */
            exchangeRate: string | null;
            /** Format: decimal */
            filledPrice: string | null;
            isCancellation: boolean;
            isinCode: string | null;
            marketCountry: components["schemas"]["MarketCountry"];
            /** Format: decimal */
            netAmount: string | null;
            /** Format: decimal */
            quantity: string | null;
            settled: boolean;
            /** Format: date */
            settlementDate: string;
            symbol: string | null;
            /** Format: decimal */
            tax: string;
            /** Format: date-time */
            transactionTime: string | null;
            transactionType: components["schemas"]["TransactionType"];
        };
        /** @enum {string} */
        TransactionType: "BUY" | "SELL" | "SECURITIES_TRANSFER_IN" | "SECURITIES_TRANSFER_OUT" | "DEPOSIT" | "WITHDRAWAL" | "EXCHANGE_IN" | "EXCHANGE_OUT" | "DIVIDEND" | "INTEREST" | "FEE";
        UsAfterMarketSession: {
            /** Format: date-time */
            endTime: string;
            /** Format: date-time */
            startTime: string;
        };
        UsDayMarketSession: {
            /** Format: date-time */
            endTime: string;
            /** Format: date-time */
            startTime: string;
        };
        UsMarketCalendarResponse: {
            nextBusinessDay: components["schemas"]["UsMarketDay"];
            previousBusinessDay: components["schemas"]["UsMarketDay"];
            today: components["schemas"]["UsMarketDay"];
        };
        UsMarketDay: {
            afterMarket?: components["schemas"]["UsAfterMarketSession"] | null;
            /** Format: date */
            date: string;
            dayMarket?: components["schemas"]["UsDayMarketSession"] | null;
            preMarket?: components["schemas"]["UsPreMarketSession"] | null;
            regularMarket?: components["schemas"]["UsRegularMarketSession"] | null;
        };
        UsPreMarketSession: {
            /** Format: date-time */
            endTime: string;
            /** Format: date-time */
            startTime: string;
        };
        UsRegularMarketSession: {
            /** Format: date-time */
            endTime: string;
            /** Format: date-time */
            startTime: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    getAccounts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["Account"][];
                    };
                };
            };
        };
    };
    getBuyingPower: {
        parameters: {
            query: {
                currency: components["schemas"]["Currency"];
            };
            header: {
                "X-Tossinvest-Account": number;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["BuyingPowerResponse"];
                    };
                };
            };
        };
    };
    getCandles: {
        parameters: {
            query: {
                adjusted?: boolean;
                before?: string;
                count?: number;
                interval: "1m" | "1d";
                symbol: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["CandlePageResponse"];
                    };
                };
            };
        };
    };
    getExchangeRate: {
        parameters: {
            query: {
                baseCurrency: components["schemas"]["Currency"];
                dateTime?: string;
                quoteCurrency: components["schemas"]["Currency"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["ExchangeRateResponse"];
                    };
                };
            };
        };
    };
    getHoldings: {
        parameters: {
            query?: {
                symbol?: string;
            };
            header: {
                "X-Tossinvest-Account": number;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["HoldingsOverview"];
                    };
                };
            };
        };
    };
    getKrMarketCalendar: {
        parameters: {
            query?: {
                date?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["KrMarketCalendarResponse"];
                    };
                };
            };
        };
    };
    getUsMarketCalendar: {
        parameters: {
            query?: {
                date?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["UsMarketCalendarResponse"];
                    };
                };
            };
        };
    };
    getMarketIndicatorCandles: {
        parameters: {
            query: {
                before?: string;
                count?: number;
                interval: "1m" | "1d";
            };
            header?: never;
            path: {
                symbol: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["MarketIndicatorCandlePageResponse"];
                    };
                };
            };
        };
    };
    getOrders: {
        parameters: {
            query: {
                cursor?: string;
                from?: string;
                limit?: number;
                status: "OPEN" | "CLOSED";
                symbol?: string;
                to?: string;
            };
            header: {
                "X-Tossinvest-Account": number;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["PaginatedOrderResponse"];
                    };
                };
            };
        };
    };
    getPrices: {
        parameters: {
            query: {
                symbols: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["PriceResponse"][];
                    };
                };
            };
        };
    };
    listSectors: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["SectorsResponse"];
                    };
                };
            };
        };
    };
    getSectorEtfs: {
        parameters: {
            query: {
                marketCountry: components["schemas"]["MarketCountry"];
            };
            header?: never;
            path: {
                sectorId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["SectorEtfsResponse"];
                    };
                };
            };
        };
    };
    getSectorStocks: {
        parameters: {
            query: {
                marketCountry: components["schemas"]["MarketCountry"];
            };
            header?: never;
            path: {
                sectorId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["SectorStocksResponse"];
                    };
                };
            };
        };
    };
    getStocks: {
        parameters: {
            query: {
                symbols: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["StockInfo"][];
                    };
                };
            };
        };
    };
    getStockWarnings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                symbol: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["StockWarning"][];
                    };
                };
            };
        };
    };
    getTransactions: {
        parameters: {
            query?: {
                cursor?: string;
                from?: string;
                limit?: number;
                to?: string;
                transactionTypes?: ("BUY" | "SELL" | "SECURITIES_TRANSFER_IN" | "SECURITIES_TRANSFER_OUT" | "DEPOSIT" | "WITHDRAWAL" | "EXCHANGE_IN" | "EXCHANGE_OUT" | "DIVIDEND" | "INTEREST" | "FEE")[];
            };
            header: {
                "X-Tossinvest-Account": number;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiResponse"] & {
                        result?: components["schemas"]["PaginatedTransactionResponse"];
                    };
                };
            };
        };
    };
    issueOAuth2Token: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/x-www-form-urlencoded": components["schemas"]["OAuth2TokenRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OAuth2TokenResponse"];
                };
            };
        };
    };
}
