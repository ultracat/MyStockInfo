// ⚠ 자동 생성 파일 — 직접 고치지 말 것. `npm run spec:types`가 backend/spec/snapshots/nh.json에서 만든다.
// 증권사 공식 명세 중 MyStock이 쓰는 엔드포인트의 구조만 담았다(scripts/spec-watch.cjs).
/* eslint-disable */
export type paths = {
    "/common/inquiry/v1/depositWithdrawal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["commonInquiryDepositWithdrawal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/common/inquiry/v1/totalTransaction": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["commonInquiryTotalTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gbstock/inquiry/v1/balance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["gbstockInquiryBalance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gbstock/inquiry/v1/dailyTransaction": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["gbstockInquiryDailyTransaction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gbstock/inquiry/v1/periodPnl": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["gbstockInquiryPeriodPnl"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/krstock/inquiry/v1/balance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["krstockInquiryBalance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/krstock/inquiry/v1/tradingPnl": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["krstockInquiryTradingPnl"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/n2/acctinfo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["commonAccountList"];
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
        post: operations["commonAuthIssueToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    commonInquiryDepositWithdrawal: {
        parameters: {
            query?: never;
            header?: {
                cts?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: {
                        act_no: string;
                        act_trd_dtl_cd: string;
                        iqr_end_dt: string;
                        iqr_sta_dt: string;
                        iqr_tp_cd: string;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        Output_0?: {
                            act_trd_tp_nm?: string;
                            cli_pe_fnm?: string;
                            opi_cus_fnm?: string;
                            ral_trd_dt?: string;
                            sps_cd_krl_anm?: string;
                            /** Format: double */
                            trd_af_dca?: number;
                            /** Format: double */
                            trd_amt?: number;
                            trd_dt?: string;
                        }[];
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    commonInquiryTotalTransaction: {
        parameters: {
            query?: never;
            header?: {
                cts?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: {
                        act_no: string;
                        act_trd_dtl_cd: string;
                        iem_llf_cd: string;
                        iqr_end_dt: string;
                        iqr_rge_cd: string;
                        iqr_sta_dt: string;
                        iqr_tp_cd: string;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        Output_0?: {
                            cli_pe_fnm?: string;
                            cur_cd?: string;
                            iem_cd?: string;
                            iem_nm?: string;
                            /** Format: int64 */
                            int_amt?: number;
                            opi_cus_fnm?: string;
                            ral_trd_dt?: string;
                            rgs_dt?: string;
                            rks3?: string;
                            rks4?: string;
                            /** Format: double */
                            rvb_odu_fee?: number;
                            sps_cd_krl_anm?: string;
                            /** Format: double */
                            tax_sum?: number;
                            /** Format: double */
                            trd_af_bnc_qty?: number;
                            /** Format: double */
                            trd_af_dca?: number;
                            /** Format: double */
                            trd_amt?: number;
                            trd_dt?: string;
                            /** Format: double */
                            trd_orn_fee?: number;
                            /** Format: double */
                            trd_qty?: number;
                            /** Format: double */
                            trd_uit_pr?: number;
                        }[];
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    gbstockInquiryBalance: {
        parameters: {
            query?: never;
            header?: {
                cts?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: {
                        act_no: string;
                        cur_cd: string;
                        fc_sec_trd_nat_cd: string;
                        qut_iqr_dit_cd: string;
                        xns_dit_cd?: string;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        Output_0?: {
                            /** Format: int64 */
                            abk_amt?: number;
                            /** Format: int64 */
                            eal_amt_sum?: number;
                            /** Format: int64 */
                            eal_pls_sum_amt?: number;
                            /** Format: double */
                            fc_abk_amt?: number;
                            /** Format: double */
                            fc_aet_amt?: number;
                            /** Format: double */
                            fc_dca?: number;
                            /** Format: double */
                            fc_eal_amt?: number;
                            /** Format: double */
                            fc_eal_pls_amt?: number;
                            /** Format: double */
                            fc_ny_stl_xcl_amt?: number;
                            /** Format: int64 */
                            krw_dca?: number;
                            /** Format: int64 */
                            krw_ny_stl_xcl_amt?: number;
                            /** Format: double */
                            krw_pft_rt?: number;
                            /** Format: double */
                            pft_rt?: number;
                            /** Format: double */
                            ptps_ttn_amt?: number;
                            /** Format: double */
                            ptps_ttn_amt1?: number;
                            /** Format: int64 */
                            tot_aet_amt?: number;
                        };
                        Output_1?: {
                            /** Format: int64 */
                            byn_cns_qty?: number;
                            cfd_lon_cd_nm?: string;
                            /** Format: int64 */
                            cns_bse_bnc_qty?: number;
                            cur_cd?: string;
                            /** Format: double */
                            eal_pft_rt?: number;
                            /** Format: double */
                            eal_pft_rt1?: number;
                            /** Format: int64 */
                            end_pr?: number;
                            /** Format: double */
                            fc_abk_amt?: number;
                            /** Format: double */
                            fc_avg_phs_pr?: number;
                            /** Format: double */
                            fc_cns_bse_phs_xps?: number;
                            /** Format: double */
                            fc_eal_amt?: number;
                            /** Format: double */
                            fc_eal_pls_amt?: number;
                            /** Format: double */
                            fc_fee?: number;
                            fc_mkt_dit_cd?: string;
                            /** Format: double */
                            fc_phs_uit_pr?: number;
                            /** Format: double */
                            fc_pls_qtr_phs_pr?: number;
                            /** Format: double */
                            fc_sec_end_pr?: number;
                            fc_sec_trd_nat_cd?: string;
                            fc_sec_trd_nat_nm?: string;
                            /** Format: double */
                            fc_sll_pft_rt?: number;
                            /** Format: double */
                            fc_sll_pls_amt?: number;
                            /** Format: double */
                            fc_stk_lws_sby_fee?: number;
                            /** Format: double */
                            fc_tax_amt?: number;
                            iem_cd?: string;
                            iem_nm?: string;
                            /** Format: int64 */
                            krw_abk_amt1?: number;
                            /** Format: int64 */
                            krw_avg_phs_pr?: number;
                            /** Format: int64 */
                            krw_cns_bse_phs_xps?: number;
                            /** Format: int64 */
                            krw_eal_amt?: number;
                            /** Format: int64 */
                            krw_eal_pls_amt?: number;
                            /** Format: int64 */
                            krw_fee?: number;
                            /** Format: int64 */
                            krw_pls_qtr_phs_pr?: number;
                            /** Format: double */
                            krw_sll_pft_rt?: number;
                            /** Format: int64 */
                            krw_sll_pls_amt?: number;
                            /** Format: int64 */
                            krw_tax_amt?: number;
                            lon_dt?: string;
                            /** Format: int64 */
                            phs_uit_pr?: number;
                            /** Format: double */
                            phs_xcg_rt?: number;
                            /** Format: double */
                            sby_fee_rt?: number;
                            /** Format: int64 */
                            sll_cns_qty?: number;
                            /** Format: int64 */
                            sll_pbl_qty1?: number;
                            /** Format: double */
                            tdt_sby_bse_xcg_rt?: number;
                            xrn_dt?: string;
                        }[];
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    gbstockInquiryDailyTransaction: {
        parameters: {
            query?: never;
            header?: {
                cts?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: {
                        act_no: string;
                        act_trd_cfc_cd: string;
                        iem_cd?: string;
                        iem_mlf_cd: string;
                        iqr_end_dt: string;
                        iqr_sta_dt: string;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        Output_0?: {
                            /** Format: double */
                            abd_sdr_xps_fc_amt?: number;
                            act_trd_tp_nm?: string;
                            /** Format: double */
                            aly_xcg_rt?: number;
                            cur_cd_nm?: string;
                            /** Format: int64 */
                            dmt_fee?: number;
                            /** Format: double */
                            fc_amt?: number;
                            /** Format: double */
                            fc_icm_tax?: number;
                            /** Format: double */
                            fc_rsd_tax?: number;
                            /** Format: double */
                            fc_sas_amt?: number;
                            /** Format: double */
                            fc_tax_sum?: number;
                            /** Format: double */
                            fc_trd_amt?: number;
                            fc_trd_dit_cd?: string;
                            /** Format: double */
                            fc_tsl_txa?: number;
                            /** Format: double */
                            icm_tax?: number;
                            iem_cd?: string;
                            iem_krl_nm?: string;
                            /** Format: double */
                            krw_amt?: number;
                            /** Format: int64 */
                            krw_sas_amt?: number;
                            /** Format: int64 */
                            krw_trd_amt?: number;
                            /** Format: double */
                            ose_fee?: number;
                            oss_iem_cd?: string;
                            oss_iem_nm?: string;
                            /** Format: double */
                            oss_stm_tax?: number;
                            ral_trd_dt?: string;
                            /** Format: double */
                            rsd_tax?: number;
                            sps_cd_nm?: string;
                            /** Format: int64 */
                            tax_sum?: number;
                            /** Format: double */
                            trd_af_bnc_qty?: number;
                            /** Format: int64 */
                            trd_af_dca?: number;
                            /** Format: double */
                            trd_af_fc_dca?: number;
                            /** Format: double */
                            trd_af_fc_mgg_amt?: number;
                            /** Format: int64 */
                            trd_af_krw_mgg_amt?: number;
                            /** Format: double */
                            trd_bf_bnc_qty?: number;
                            /** Format: int64 */
                            trd_bf_dca?: number;
                            /** Format: double */
                            trd_bf_fc_dca?: number;
                            trd_dt?: string;
                            /** Format: double */
                            trd_qty?: number;
                            /** Format: int64 */
                            trd_sno?: number;
                            /** Format: double */
                            trd_uit_pr?: number;
                            /** Format: int64 */
                            tsl_cmu_txa?: number;
                            /** Format: double */
                            tsl_mgg_amt?: number;
                        }[];
                        Output_1?: {
                            /** Format: int64 */
                            amt_sum?: number;
                            /** Format: int64 */
                            drn_tal?: number;
                            /** Format: int64 */
                            fee_sum_amt?: number;
                            /** Format: int64 */
                            rpm_tal?: number;
                            /** Format: int64 */
                            tax_sum_amt?: number;
                        };
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    gbstockInquiryPeriodPnl: {
        parameters: {
            query?: never;
            header?: {
                cts?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: {
                        act_no: string;
                        end_orr_dt: string;
                        fc_sec_trd_nat_cd?: string;
                        iem_cd?: string;
                        iqr_dit: string;
                        sta_orr_dt: string;
                        trd_cur_cd?: string;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        Output_0?: {
                            /** Format: int64 */
                            byn_qty_sum?: number;
                            /** Format: double */
                            fc_byn_amt_sum?: number;
                            /** Format: double */
                            fc_rzt_pft_rt?: number;
                            /** Format: double */
                            fc_rzt_pls_sum?: number;
                            /** Format: double */
                            fc_sby_pft_rt?: number;
                            /** Format: double */
                            fc_sby_pls_sum?: number;
                            /** Format: double */
                            fc_sdr_xps_sum?: number;
                            /** Format: double */
                            fc_sll_amt_sum?: number;
                            /** Format: int64 */
                            sll_qty_sum?: number;
                        };
                        Output_1?: {
                            /** Format: int64 */
                            byn_qty?: number;
                            /** Format: double */
                            byn_uit_pr?: number;
                            /** Format: double */
                            fc_byn_amt1?: number;
                            /** Format: double */
                            fc_rzt_pft_rt?: number;
                            /** Format: double */
                            fc_rzt_pls?: number;
                            /** Format: double */
                            fc_sby_pft_rt?: number;
                            /** Format: double */
                            fc_sby_pls?: number;
                            /** Format: double */
                            fc_sdr_xps?: number;
                            fc_sec_trd_nat_cd?: string;
                            fc_sec_trd_nat_nm?: string;
                            /** Format: double */
                            fc_sll_amt?: number;
                            orr_dt?: string;
                            /** Format: int64 */
                            sll_qty?: number;
                            /** Format: double */
                            sll_uit_pr?: number;
                            trd_cur_cd?: string;
                        }[];
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    krstockInquiryBalance: {
        parameters: {
            query?: never;
            header?: {
                cts?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: {
                        act_no: string;
                        aet_bse: string;
                        aly_qut_cd: string;
                        bnc_bse_cd: string;
                        ltg_aot_dit_cd: string;
                        qut_dit_cd: string;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        Output_0?: {
                            act_atv_tp_dtl_cd?: string;
                            cfd_pdt_tp_nm?: string;
                            /** Format: int64 */
                            csh_wtm?: number;
                            /** Format: int64 */
                            dca?: number;
                            /** Format: int64 */
                            drn_pbl_amt?: number;
                            /** Format: int64 */
                            ect_lga?: number;
                            /** Format: int64 */
                            int_ny_pmt_amt?: number;
                            /** Format: int64 */
                            lon_amt?: number;
                            /** Format: double */
                            mgg_rt?: number;
                            /** Format: int64 */
                            nas_amt?: number;
                            /** Format: int64 */
                            nxt_dd_dca?: number;
                            /** Format: int64 */
                            nxt2_dd_dca?: number;
                            /** Format: int64 */
                            ny_rdp_amt?: number;
                            /** Format: int64 */
                            orr_pbl_amt2?: number;
                            /** Format: int64 */
                            orr_pbl_amt3?: number;
                            /** Format: int64 */
                            orr_pbl_amt4?: number;
                            /** Format: double */
                            pft_rt?: number;
                            /** Format: int64 */
                            rba?: number;
                            /** Format: int64 */
                            sba_amt?: number;
                            /** Format: int64 */
                            sba_wtm?: number;
                            /** Format: int64 */
                            sll_edn_amt?: number;
                            /** Format: int64 */
                            slo_mgg_amt?: number;
                            /** Format: int64 */
                            tot_aet_amt?: number;
                            /** Format: int64 */
                            tot_byn_amt?: number;
                            /** Format: int64 */
                            tot_eal_amt?: number;
                            /** Format: int64 */
                            tot_eal_pls?: number;
                        };
                        Output_1?: {
                            /** Format: int64 */
                            eal_amt?: number;
                            /** Format: int64 */
                            eal_pls_amt?: number;
                            iem_cd?: string;
                            iem_nm?: string;
                            /** Format: double */
                            itg_bnc_qty?: number;
                            /** Format: int64 */
                            lon_bnc_amt?: number;
                            lon_byn_dt?: string;
                            /** Format: int64 */
                            now_pr?: number;
                            /** Format: double */
                            ny_stl_qty?: number;
                            /** Format: double */
                            pft_rt?: number;
                            /** Format: int64 */
                            phs_pr?: number;
                            /** Format: double */
                            rsdl_qty?: number;
                            /** Format: int64 */
                            sll_amt?: number;
                            /** Format: int64 */
                            sll_pls_amt?: number;
                            tp_cd_nm?: string;
                            wtm_rt?: string;
                            xrn_dt?: string;
                        }[];
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    krstockInquiryTradingPnl: {
        parameters: {
            query?: never;
            header?: {
                cts?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: {
                        act_no: string;
                        iqr_end_dt: string;
                        iqr_sta_dt: string;
                    };
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        Output_0?: {
                            /** Format: int64 */
                            byn_amt?: number;
                            /** Format: int64 */
                            byn_cnt?: number;
                            /** Format: int64 */
                            byn_fee?: number;
                            /** Format: double */
                            byn_qty?: number;
                            /** Format: double */
                            pft_rt?: number;
                            /** Format: int64 */
                            pls_amt?: number;
                            /** Format: int64 */
                            sll_abk_amt?: number;
                            /** Format: int64 */
                            sll_amt?: number;
                            /** Format: int64 */
                            sll_cnt?: number;
                            /** Format: double */
                            sll_qty?: number;
                            /** Format: int64 */
                            sll_tax_sum?: number;
                        };
                        Output_1?: {
                            /** Format: int64 */
                            byn_amt?: number;
                            /** Format: int64 */
                            byn_cnt?: number;
                            /** Format: int64 */
                            byn_fee?: number;
                            /** Format: double */
                            byn_qty?: number;
                            /** Format: double */
                            byn_uit_pr?: number;
                            iem_cd?: string;
                            iem_nm?: string;
                            /** Format: double */
                            pft_rt?: number;
                            /** Format: int64 */
                            pls_amt?: number;
                            /** Format: int64 */
                            sll_abk_amt?: number;
                            /** Format: int64 */
                            sll_amt?: number;
                            /** Format: int64 */
                            sll_cnt?: number;
                            /** Format: double */
                            sll_qty?: number;
                            /** Format: int64 */
                            sll_tax_sum?: number;
                            /** Format: double */
                            sll_uit_pr?: number;
                        }[];
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    commonAccountList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    Input_0?: Record<string, never>;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        cust_no?: string;
                        Output_0?: {
                            acct_no?: string;
                            acct_type?: string;
                        }[];
                        rsp_cd?: string;
                        rsp_msg?: string;
                    };
                };
            };
        };
    };
    commonAuthIssueToken: {
        parameters: {
            query: {
                appkey: string;
                appsecretkey: string;
                grant_type: string;
                scope: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": Record<string, never>;
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        access_token: string;
                        expires_in?: number;
                        scope?: string;
                        token_type?: string;
                    };
                };
            };
        };
    };
}
