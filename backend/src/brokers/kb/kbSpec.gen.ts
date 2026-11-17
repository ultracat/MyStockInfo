// ⚠ 자동 생성 파일 — 직접 고치지 말 것. `npm run spec:types`가 backend/spec/snapshots/kb.json에서 만든다.
// 증권사 공식 명세 중 MyStock이 쓰는 엔드포인트의 구조만 담았다(scripts/spec-watch.cjs).
/* eslint-disable */
// 기준: kbsecurities/kb-openapi 공개 명세(계좌 TR은 고정 커밋 159480c) + 실제 응답 기록(kb-live.json, 있으면).

export interface KbRequests {
  SIQM4900: {
    "stnd_is_cd": string;
  };
  SSQM2952: {
    "excg_mktpr_ccd": string;
  };
  SWQA2301: {
    "inq_clsf": string;
    "inq_clsf1"?: string;
    "inq_clsf2"?: string;
    "inq_clsf3"?: string;
    "inq_clsf4"?: string;
    "inq_clsf5"?: string;
    "inq_clsf6"?: string;
    "strt_dt"?: string;
    "end_dt"?: string;
    "is_no"?: string;
    "strt_no"?: string;
    "nxt_key"?: string;
    "srt_clsf"?: string;
    "dl_clsf"?: string;
    "dl_md_ccd"?: string;
    "md_isnc_tno"?: string;
    "crdt_crd_isnc_info"?: string;
    "onl_prt_ccd"?: string;
    "isng_bl_at_trsns_xcl_f"?: string;
  };
}

export interface KbResponses {
  /** POST /api/v1/siqm4900 (현재 공개 명세) */
  SIQM4900: {
    "dl_crncy_clsf_nm": string;
    "dmstc_clsf_nm": string;
    "eng_is_nm": string;
    "eng_is_nm2": string;
    "eng_shrt_nm": string;
    "eng_shrt_nm2": string;
    "gds_rprst_cd": string;
    "hngl_is_nm": string;
    "hngl_is_nm2": string;
    "hngl_shrt_nm": string;
    "hngl_shrt_nm2": string;
    "io_rstn_clsf_nm": string;
    "io_rstn_end_dt": string;
    "io_rstn_strt_dt": string;
    "is_dtl_typ_cd": string;
    "is_dtl_typ_nm": string;
    "is_rgst_clsf_nm": string;
    "is_typ_cd": string;
    "is_typ_nm": string;
    "lnd_clsf_nm": string;
    "o_clsf": string;
    "o_lngth": string;
    "o_msg": string;
    "rsk_grd_clsf_cd": string;
    "rsk_grd_nm": string;
    "shrt_is_cd": string;
    "slf_is_cd": string;
    "stnd_is_cd": string;
    "symbl_is_cd": string;
    "trd_rstn_clsf_nm": string;
    "trd_rstn_end_dt": string;
    "trd_rstn_strt_dt": string;
  };
  /** POST /api/v1/ssqm2952 (고정 기준 159480c — 현재 공개본엔 없음) */
  SSQM2952: {
    "brwg_mrtg_csh_est_amt": string;
    "brwg_nd_mrtg_amt": string;
    "byng_amt_sum": string;
    "cma_pldg_est_amt": string;
    "dy_tfnd": string;
    "elw_excs_mgn": string;
    "etc_lndng_amt": string;
    "fcrncy_tfnd_krw_exch_amt": string;
    "fncng_amt": string;
    "fncng_amt_sum": string;
    "gnl_ln_amt": string;
    "grid_cnt1": string;
    "itst_npymt_amt": string;
    "mrtg_rt": string;
    "mrtg_shrtg_amt": string;
    "ndy_o_amt_psbl_amt": string;
    "ndy_tfnd": string;
    "nrfnd_fncng_amt": string;
    "nt_asts_val_amt": string;
    "nt_byng_amt": string;
    "nxt2_dy_o_amt_psbl_amt": string;
    "nxt2_dy_tfnd": string;
    "o_clsf": string;
    "o_lngth": string;
    "o_msg": string;
    "scrts_nt_val_amt": string;
    "tl_data_cnt": string;
    "val_amt_sum": string;
    "val_pl": string;
    "val_pl_sum": string;
    "val_yld": string;
    "val_yld_sum": string;
    Record1?: Array<{
      "clsf"?: string;
      "crncy_cd"?: string;
      "is_cd"?: string;
      "is_nm"?: string;
      "hld_q"?: string;
      "ordr_psbl_q"?: string;
      "nstmt_s_q"?: string;
      "nstmt_b_q"?: string;
      "ec_q"?: string;
      "byng_amt"?: string;
      "now_prc"?: string;
      "byng_avr_prc"?: string;
      "val_amt"?: string;
      "fncng_amt"?: string;
      "val_pl"?: string;
      "val_yld"?: string;
      "is_dtl_typ_cd"?: string;
      "fee_r_p9"?: string;
      "addt_amt"?: string;
      "dl_tx_r_p4"?: string;
      "ffs_tx_r_p4"?: string;
      "hld_q_p6"?: string;
      "ordr_psbl_q_p6"?: string;
      "nstmt_s_q_p6"?: string;
      "nstmt_b_q_p6"?: string;
      "ec_q_p6"?: string;
      "nxtd_lstng_ccd"?: string;
      "fnl_ccls_excg_cd"?: string;
    }>;
  };
  /** POST /api/v1/swqa2301 (고정 기준 159480c — 현재 공개본엔 없음) */
  SWQA2301: {
    "grid_cnt1": string;
    "nxt_key": string;
    "o_clsf": string;
    "o_lngth": string;
    "o_msg": string;
    Record1?: Array<{
      "dl_dt"?: string;
      "dl_sq"?: string;
      "q"?: string;
      "tfnd_blnc"?: string;
      "fncng_amt"?: string;
      "fee"?: string;
      "incm_tx"?: string;
      "dl_txtn_uprc"?: string;
      "itst_rpay_amt"?: string;
      "etc_chck_amt"?: string;
      "crncy_clsf_nm"?: string;
      "stmt_pr_pymt_amt"?: string;
      "fcrncy_tfnd_ra"?: string;
      "smry_nm"?: string;
      "ec_amt"?: string;
      "dl_uprc"?: string;
      "ocp_pymt_amt"?: string;
      "dl_tx"?: string;
      "rsdnt_tx"?: string;
      "itst_use_fe"?: string;
      "arrs_fee"?: string;
      "scrts_rpay_q"?: string;
      "exch_r"?: string;
      "stmt_pr_pymt_amt_rpay"?: string;
      "dprt_cd_nm"?: string;
      "is_nm"?: string;
      "dl_amt"?: string;
      "bnf_blnc_val"?: string;
      "bnf_no"?: string;
      "ffs_tx"?: string;
      "trsf_tx"?: string;
      "rcvbl_rpay_amt"?: string;
      "etc_lndng_amt_rpay_amt"?: string;
      "scrts_blnc_q"?: string;
      "abrd_fee"?: string;
      "fcrncy_amt"?: string;
      "cprty_ac_nm"?: string;
      "tx"?: string;
      "stnd_is_cd"?: string;
      "fcrncy_tfnd"?: string;
      "smry_typ_cd"?: string;
      "dl_typ_cd"?: string;
      "dl_mkt"?: string;
    }>;
  };
}
