// ⚠ 자동 생성 파일 — 직접 고치지 말 것. `npm run spec:types`가 backend/spec/snapshots/kiwoom.json에서 만든다.
// 증권사 공식 명세 중 MyStock이 쓰는 엔드포인트의 구조만 담았다(scripts/spec-watch.cjs).
/* eslint-disable */
// 키움 명세는 응답 필드를 모두 required "N", 형식 String으로 적는다 — 그래서 전부 선택(?)이고 문자열이다.

export interface KiwoomRequests {
  au10001: {
    "grant_type": string;
    "appkey": string;
    "secretkey": string;
  };
  ka00001: Record<string, never>;
  ka10073: {
    "stk_cd"?: string;
    "strt_dt": string;
    "end_dt": string;
  };
  kt00001: {
    "qry_tp": string;
  };
  kt00015: {
    "strt_dt": string;
    "end_dt": string;
    "tp": string;
    "stk_cd"?: string;
    "crnc_cd"?: string;
    "gds_tp": string;
    "frgn_stex_code"?: string;
    "dmst_stex_tp": string;
    "qry_sort_tp"?: string;
  };
  kt00018: {
    "qry_tp": string;
    "dmst_stex_tp": string;
  };
  ust21070: {
    "stex_tp"?: string;
    "stk_cd"?: string;
  };
  ust21110: Record<string, never>;
  ust21530: {
    "strt_dt"?: string;
    "end_dt"?: string;
    "fc_krw_tp"?: string;
  };
}

export interface KiwoomResponses {
  /** 접근토큰 발급 — POST /oauth2/token */
  au10001: {
    "expires_dt"?: string;
    "token_type"?: string;
    "token"?: string;
  };
  /** 계좌번호조회 — POST /api/dostk/acnt */
  ka00001: {
    "acctNo"?: string;
  };
  /** 일자별종목별실현손익요청_기간 — POST /api/dostk/acnt */
  ka10073: {
    "dt_stk_rlzt_pl"?: Array<{
      "dt"?: string;
      "tdy_htssel_cmsn"?: string;
      "stk_nm"?: string;
      "cntr_qty"?: string;
      "buy_uv"?: string;
      "cntr_pric"?: string;
      "tdy_sel_pl"?: string;
      "pl_rt"?: string;
      "stk_cd"?: string;
      "tdy_trde_cmsn"?: string;
      "tdy_trde_tax"?: string;
      "wthd_alowa"?: string;
      "loan_dt"?: string;
      "crd_tp"?: string;
    }>;
  };
  /** 예수금상세현황요청 — POST /api/dostk/acnt */
  kt00001: {
    "entr"?: string;
    "profa_ch"?: string;
    "bncr_profa_ch"?: string;
    "nxdy_bncr_sell_exct"?: string;
    "fc_stk_krw_repl_set_amt"?: string;
    "crd_grnta_ch"?: string;
    "crd_grnt_ch"?: string;
    "add_grnt_ch"?: string;
    "etc_profa"?: string;
    "uncl_stk_amt"?: string;
    "shrts_prica"?: string;
    "crd_set_grnta"?: string;
    "chck_ina_amt"?: string;
    "etc_chck_ina_amt"?: string;
    "crd_grnt_ruse"?: string;
    "knx_asset_evltv"?: string;
    "elwdpst_evlta"?: string;
    "crd_ls_rght_frcs_amt"?: string;
    "lvlh_join_amt"?: string;
    "lvlh_trns_alowa"?: string;
    "repl_amt"?: string;
    "remn_repl_evlta"?: string;
    "trst_remn_repl_evlta"?: string;
    "bncr_remn_repl_evlta"?: string;
    "profa_repl"?: string;
    "crd_grnta_repl"?: string;
    "crd_grnt_repl"?: string;
    "add_grnt_repl"?: string;
    "rght_repl_amt"?: string;
    "pymn_alow_amt"?: string;
    "wrap_pymn_alow_amt"?: string;
    "ord_alow_amt"?: string;
    "bncr_buy_alowa"?: string;
    "20stk_ord_alow_amt"?: string;
    "30stk_ord_alow_amt"?: string;
    "40stk_ord_alow_amt"?: string;
    "100stk_ord_alow_amt"?: string;
    "ch_uncla"?: string;
    "ch_uncla_dlfe"?: string;
    "ch_uncla_tot"?: string;
    "crd_int_npay"?: string;
    "int_npay_amt_dlfe"?: string;
    "int_npay_amt_tot"?: string;
    "etc_loana"?: string;
    "etc_loana_dlfe"?: string;
    "etc_loan_tot"?: string;
    "nrpy_loan"?: string;
    "loan_sum"?: string;
    "ls_sum"?: string;
    "crd_grnt_rt"?: string;
    "mdstrm_usfe"?: string;
    "min_ord_alow_yn"?: string;
    "loan_remn_evlt_amt"?: string;
    "dpst_grntl_remn"?: string;
    "sell_grntl_remn"?: string;
    "d1_entra"?: string;
    "d1_slby_exct_amt"?: string;
    "d1_buy_exct_amt"?: string;
    "d1_out_rep_mor"?: string;
    "d1_sel_exct_amt"?: string;
    "d1_pymn_alow_amt"?: string;
    "d2_entra"?: string;
    "d2_slby_exct_amt"?: string;
    "d2_buy_exct_amt"?: string;
    "d2_out_rep_mor"?: string;
    "d2_sel_exct_amt"?: string;
    "d2_pymn_alow_amt"?: string;
    "50stk_ord_alow_amt"?: string;
    "60stk_ord_alow_amt"?: string;
    "stk_entr_prst"?: Array<{
      "crnc_cd"?: string;
      "fx_entr"?: string;
      "fc_krw_repl_evlta"?: string;
      "fc_trst_profa"?: string;
      "pymn_alow_amt"?: string;
      "pymn_alow_amt_entr"?: string;
      "ord_alow_amt_entr"?: string;
      "fc_uncla"?: string;
      "fc_ch_uncla"?: string;
      "dly_amt"?: string;
      "d1_fx_entr"?: string;
      "d2_fx_entr"?: string;
      "d3_fx_entr"?: string;
      "d4_fx_entr"?: string;
    }>;
  };
  /** 위탁종합거래내역요청 — POST /api/dostk/acnt */
  kt00015: {
    "trst_ovrl_trde_prps_array"?: Array<{
      "trde_dt"?: string;
      "trde_no"?: string;
      "rmrk_nm"?: string;
      "crd_deal_tp_nm"?: string;
      "exct_amt"?: string;
      "loan_amt_rpya"?: string;
      "fc_trde_amt"?: string;
      "fc_exct_amt"?: string;
      "entra_remn"?: string;
      "crnc_cd"?: string;
      "trde_ocr_tp"?: string;
      "trde_kind_nm"?: string;
      "stk_nm"?: string;
      "trde_amt"?: string;
      "trde_agri_tax"?: string;
      "rpy_diffa"?: string;
      "fc_trde_tax"?: string;
      "dly_sum"?: string;
      "fc_entra"?: string;
      "mdia_tp_nm"?: string;
      "io_tp"?: string;
      "io_tp_nm"?: string;
      "orig_deal_no"?: string;
      "stk_cd"?: string;
      "trde_qty_jwa_cnt"?: string;
      "cmsn"?: string;
      "int_ls_usfe"?: string;
      "fc_cmsn"?: string;
      "fc_dly_sum"?: string;
      "vlbl_nowrm"?: string;
      "proc_tm"?: string;
      "isin_cd"?: string;
      "stex_cd"?: string;
      "stex_nm"?: string;
      "trde_unit"?: string;
      "incm_resi_tax"?: string;
      "loan_dt"?: string;
      "uncl_ocr"?: string;
      "rpym_sum"?: string;
      "cntr_dt"?: string;
      "rcpy_no"?: string;
      "prcsr"?: string;
      "proc_brch"?: string;
      "trde_stle"?: string;
      "txon_base_pric"?: string;
      "tax_sum_cmsn"?: string;
      "frgn_pay_txam"?: string;
      "fc_uncl_ocr"?: string;
      "rpym_sum_fr"?: string;
      "rcpmnyer"?: string;
      "trde_prtc_tp"?: string;
    }>;
  };
  /** 계좌평가잔고내역요청 — POST /api/dostk/acnt */
  kt00018: {
    "tot_pur_amt"?: string;
    "tot_evlt_amt"?: string;
    "tot_evlt_pl"?: string;
    "tot_prft_rt"?: string;
    "prsm_dpst_aset_amt"?: string;
    "tot_loan_amt"?: string;
    "tot_crd_loan_amt"?: string;
    "tot_crd_ls_amt"?: string;
    "acnt_evlt_remn_indv_tot"?: Array<{
      "stk_cd"?: string;
      "stk_nm"?: string;
      "evltv_prft"?: string;
      "prft_rt"?: string;
      "pur_pric"?: string;
      "pred_close_pric"?: string;
      "rmnd_qty"?: string;
      "trde_able_qty"?: string;
      "cur_prc"?: string;
      "pred_buyq"?: string;
      "pred_sellq"?: string;
      "tdy_buyq"?: string;
      "tdy_sellq"?: string;
      "pur_amt"?: string;
      "pur_cmsn"?: string;
      "evlt_amt"?: string;
      "sell_cmsn"?: string;
      "tax"?: string;
      "sum_cmsn"?: string;
      "poss_rt"?: string;
      "crd_tp"?: string;
      "crd_tp_nm"?: string;
      "crd_loan_dt"?: string;
    }>;
  };
  /** 미국주식 원장잔고확인 — POST /api/us/acnt */
  ust21070: {
    "crnc_code"?: string;
    "tot_evlt_amt"?: string;
    "tot_prch_amt"?: string;
    "tot_pl_amt"?: string;
    "tot_pl_rt"?: string;
    "tdy_book_amt"?: string;
    "tdy_pl_amt"?: string;
    "tdy_pl_rt"?: string;
    "tot_evlt_amt_krw"?: string;
    "tot_prch_amt_krw"?: string;
    "tot_pl_amt_krw"?: string;
    "tdy_book_amt_krw"?: string;
    "tdy_pl_amt_krw"?: string;
    "result_list"?: Array<{
      "stex_nm"?: string;
      "crnc_code"?: string;
      "stk_cd"?: string;
      "frgn_stk_nm"?: string;
      "qty"?: string;
      "poss_qty"?: string;
      "sell_alowq"?: string;
      "pred_cntr_sellq"?: string;
      "pred_cntr_buyq"?: string;
      "tdy_cntr_sellq"?: string;
      "tdy_cntr_buyq"?: string;
      "frgn_stk_book_uv"?: string;
      "now_pric"?: string;
      "evlt_amt"?: string;
      "pl_amt"?: string;
      "pl_rt"?: string;
      "evlt_amt_krw"?: string;
      "pl_amt_krw"?: string;
      "natn_nm"?: string;
      "exch_rate"?: string;
      "frgn_stk_book_uv_krw"?: string;
      "now_pric_krw"?: string;
      "frgn_stk_book_amt"?: string;
      "frgn_stk_book_amt_krw"?: string;
    }>;
  };
  /** 해외주식 예수금 — POST /api/us/acnt */
  ust21110: {
    "krw_entra"?: string;
    "ch_uncla"?: string;
    "etc_loana"?: string;
    "result_list"?: Array<{
      "crnc_code"?: string;
      "crnc_nm"?: string;
      "fc_entra"?: string;
      "fc_pymn_alowa"?: string;
      "futr_repl_profa"?: string;
      "fc_booka"?: string;
      "fc_ord_alowa"?: string;
      "futr_profa_booka"?: string;
      "fc_ch_uncla"?: string;
      "fc_etc_loana"?: string;
    }>;
  };
  /** 미국주식 실현손익 — POST /api/us/acnt */
  ust21530: {
    "tot_sell_amt"?: string;
    "tot_buy_amt"?: string;
    "tot_cmsn_tax"?: string;
    "tot_exct_amt"?: string;
    "tot_pl_amt"?: string;
    "tot_pl_rt"?: string;
    "result_list"?: Array<{
      "sell_dt"?: string;
      "stk_cd"?: string;
      "frgn_stk_nm"?: string;
      "sell_qty"?: string;
      "avg_buy_uv"?: string;
      "buy_amt"?: string;
      "avg_sell_uv"?: string;
      "sell_amt"?: string;
      "cmsn_tax"?: string;
      "pl_amt"?: string;
      "pl_rt"?: string;
      "prch_exrt"?: string;
      "sell_exrt"?: string;
      "krw_chg_dfrn_pl_amt"?: string;
      "krw_chg_pl_amt"?: string;
      "comm_ord_tp"?: string;
      "stex_nm"?: string;
      "natn_nm"?: string;
    }>;
  };
}
