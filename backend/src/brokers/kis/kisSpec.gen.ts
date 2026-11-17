// ⚠ 자동 생성 파일 — 직접 고치지 말 것. `npm run kis:types`가 backend/spec/kis-catalog.json(공식 예제 74b0a08)과
// backend/spec/snapshots/kis-live.json(실제 응답 기록 2026-11-17)에서 만든다(scripts/kis-verify.cjs).
// 값은 KIS가 전부 문자열로 준다. 실측한 블록의 필드는 필수, 실측 전 블록은 공식 예제 목록이라 선택.
/* eslint-disable */

export interface KisResponses {
  /** [국내주식] 업종/기타 > 국내휴장일조회[국내주식-040] — GET /uapi/domestic-stock/v1/quotations/chk-holiday (실측 2026-11-17) */
  CTCA0903R: {
    output?: Array<{
      bass_dt: string;
      bzdy_yn: string;
      opnd_yn: string;
      sttl_day_yn: string;
      tr_day_yn: string;
      wday_dvsn_cd: string;
    }>;
  };
  /** [국내주식] 종목정보 - 주식기본조회 — GET /uapi/domestic-stock/v1/quotations/search-stock-info (실측 2026-11-17) */
  CTPF1002R: {
    output?: {
      admn_item_yn: string;
      bfdy_clpr: string;
      clpr_chng_dt: string;
      cpta: string;
      cptt_trad_tr_psbl_yn: string;
      crfd_item_yn: string;
      dpsi_aptm_erlm_yn: string;
      dpsi_erlm_cncl_dt: string;
      elec_scty_yn: string;
      etf_chas_erng_rt_dbnb: string;
      etf_cu_qty: string;
      etf_dvsn_cd: string;
      etf_etn_ivst_heed_item_yn: string;
      etf_txtn_type_cd: string;
      etf_type_cd: string;
      excg_dvsn_cd: string;
      frbd_mket_lstg_abol_dt: string;
      frbd_mket_lstg_dt: string;
      frnr_psnl_lmt_rt: string;
      idx_bztp_lcls_cd: string;
      idx_bztp_lcls_cd_name: string;
      idx_bztp_mcls_cd: string;
      idx_bztp_mcls_cd_name: string;
      idx_bztp_scls_cd: string;
      idx_bztp_scls_cd_name: string;
      issu_istt_cd: string;
      issu_pric: string;
      kosdaq_mket_lstg_abol_dt: string;
      kosdaq_mket_lstg_dt: string;
      kospi200_item_yn: string;
      lstg_abol_dt: string;
      lstg_cptl_amt: string;
      lstg_rqsr_issu_istt_cd: string;
      lstg_rqsr_item_cd: string;
      lstg_stqt: string;
      mfnd_end_dt: string;
      mfnd_opng_dt: string;
      mket_id_cd: string;
      nwst_odst_dvsn_cd: string;
      nxt_tr_stop_yn: string;
      ocr_no: string;
      oilf_fund_yn: string;
      papr: string;
      pdno: string;
      prdt_abrv_name: string;
      prdt_eng_abrv_name: string;
      prdt_eng_name: string;
      prdt_eng_name120: string;
      prdt_name: string;
      prdt_name120: string;
      prdt_type_cd: string;
      reits_kind_cd: string;
      sbst_pric: string;
      scts_mket_lstg_abol_dt: string;
      scts_mket_lstg_dt: string;
      scty_grp_id_cd: string;
      setl_mmdd: string;
      stck_kind_cd: string;
      std_idst_clsf_cd: string;
      std_idst_clsf_cd_name: string;
      std_pdno: string;
      stln_int_rt_dvsn_cd: string;
      thco_sbst_pric: string;
      thco_sbst_pric_chng_dt: string;
      thdt_clpr: string;
      tr_stop_yn: string;
      trst_istt_issu_istt_cd: string;
    };
  };
  /** [국내주식] 주문/계좌 > 기간별계좌권리현황조회 [국내주식-211] — GET /uapi/domestic-stock/v1/trading/period-rights (실측 2026-11-17) */
  CTRGA011R: {
    output?: Array<{
      bass_dt: string;
      cash_dfrm_dt: string;
      cblc_qty: string;
      dlay_int_amt: string;
      excs_alct_qty: string;
      last_alct_amt: string;
      last_alct_qty: string;
      last_ftsk_chgs: string;
      last_ftsk_qty: string;
      lstg_dt: string;
      lstg_stqt: string;
      pdno: string;
      prdt_name: string;
      prdt_type_cd: string;
      rdpt_prca: string;
      rfnd_amt: string;
      rfnd_dt: string;
      rght_cblc_type_cd: string;
      rght_type_cd: string;
      rptt_pdno: string;
      rqst_amt: string;
      rqst_dt: string;
      rqst_qty: string;
      sbsc_end_dt: string;
      sbsc_unpr: string;
      shtn_pdno: string;
      tax_amt: string;
      tot_alct_qty: string;
    }>;
  };
  /** [해외주식] 시세분석 > 해외주식 기간별권리조회 [해외주식-052] — GET /uapi/overseas-price/v1/quotations/period-rights (실측 2026-11-17) */
  CTRGT011R: {
    output?: Array<{
      acpl_bass_dt: string;
      alct_frcr_unpr: string;
      bass_dt: string;
      cash_alct_rt: string;
      crcy_cd: string;
      crcy_cd2: string;
      crcy_cd3: string;
      crcy_cd4: string;
      dfnt_yn: string;
      pdno: string;
      prdt_name: string;
      prdt_type_cd: string;
      rght_type_cd: string;
      sbsc_end_dt: string;
      sbsc_strt_dt: string;
      stck_alct_rt: string;
      std_pdno: string;
      stkp_dvdn_frcr_amt2: string;
      stkp_dvdn_frcr_amt3: string;
      stkp_dvdn_frcr_amt4: string;
    }>;
  };
  /** [해외주식] 주문/계좌 > 해외주식 체결기준현재잔고 [v1_해외주식-008] — GET /uapi/overseas-stock/v1/trading/inquire-present-balance (실측 2026-11-17) */
  CTRP6504R: {
    output1?: Array<{
      /** 실측 전 — 공식 예제 COLUMN_MAPPING */
      acpl_cstd_crcy_yn?: string;
      avg_unpr3?: string;
      bass_exrt?: string;
      buy_crcy_cd?: string;
      cblc_qty13?: string;
      ccld_qty_smtl1?: string;
      crcy_cd?: string;
      evlu_pfls_amt2?: string;
      evlu_pfls_rt1?: string;
      frcr_buy_amt_smtl?: string;
      frcr_buy_mgn_amt?: string;
      frcr_dncl_amt_2?: string;
      frcr_drwg_psbl_amt_1?: string;
      frcr_etc_mgna?: string;
      frcr_evlu_amt2?: string;
      frcr_pchs_amt?: string;
      frcr_sll_amt_smtl?: string;
      frst_bltn_exrt?: string;
      item_lnkg_excg_cd?: string;
      loan_dt?: string;
      loan_expd_dt?: string;
      loan_rmnd?: string;
      natn_kor_name?: string;
      nxdy_frcr_drwg_psbl_amt?: string;
      ord_psbl_qty1?: string;
      output3?: string;
      ovrs_excg_cd?: string;
      ovrs_now_pric1?: string;
      pchs_rmnd_wcrc_amt?: string;
      pdno?: string;
      prdt_type_cd?: string;
      std_pdno?: string;
      thdt_buy_ccld_frcr_amt?: string;
      thdt_buy_ccld_qty1?: string;
      thdt_sll_ccld_frcr_amt?: string;
      thdt_sll_ccld_qty1?: string;
      tr_mket_name?: string;
      unit_amt?: string;
    }>;
    output2?: Array<{
      /** 실측 전 — 공식 예제 COLUMN_MAPPING */
      acpl_cstd_crcy_yn?: string;
      avg_unpr3?: string;
      bass_exrt?: string;
      buy_crcy_cd?: string;
      cblc_qty13?: string;
      ccld_qty_smtl1?: string;
      crcy_cd?: string;
      evlu_pfls_amt2?: string;
      evlu_pfls_rt1?: string;
      frcr_buy_amt_smtl?: string;
      frcr_buy_mgn_amt?: string;
      frcr_dncl_amt_2?: string;
      frcr_drwg_psbl_amt_1?: string;
      frcr_etc_mgna?: string;
      frcr_evlu_amt2?: string;
      frcr_pchs_amt?: string;
      frcr_sll_amt_smtl?: string;
      frst_bltn_exrt?: string;
      item_lnkg_excg_cd?: string;
      loan_dt?: string;
      loan_expd_dt?: string;
      loan_rmnd?: string;
      natn_kor_name?: string;
      nxdy_frcr_drwg_psbl_amt?: string;
      ord_psbl_qty1?: string;
      output3?: string;
      ovrs_excg_cd?: string;
      ovrs_now_pric1?: string;
      pchs_rmnd_wcrc_amt?: string;
      pdno?: string;
      prdt_type_cd?: string;
      std_pdno?: string;
      thdt_buy_ccld_frcr_amt?: string;
      thdt_buy_ccld_qty1?: string;
      thdt_sll_ccld_frcr_amt?: string;
      thdt_sll_ccld_qty1?: string;
      tr_mket_name?: string;
      unit_amt?: string;
    }>;
    output3?: {
      buy_mgn_amt: string;
      cma_evlu_amt: string;
      dncl_amt: string;
      etc_mgna: string;
      evlu_amt_smtl: string;
      evlu_amt_smtl_amt: string;
      evlu_erng_rt1: string;
      evlu_pfls_amt_smtl: string;
      frcr_evlu_tota: string;
      frcr_use_psbl_amt: string;
      mgna_tota: string;
      pchs_amt_smtl: string;
      pchs_amt_smtl_amt: string;
      tot_asst_amt: string;
      tot_dncl_amt: string;
      tot_evlu_pfls_amt: string;
      tot_frcr_cblc_smtl: string;
      tot_loan_amt: string;
      ustl_buy_amt_smtl: string;
      ustl_sll_amt_smtl: string;
      wdrw_psbl_tot_amt: string;
    };
  };
  /** [국내주식] 주문/계좌 > 주식일별주문체결조회[v1_국내주식-005] — GET /uapi/domestic-stock/v1/trading/inquire-daily-ccld (실측 2026-11-17) */
  CTSC9215R: {
    output1?: Array<{
      avg_prvs: string;
      ccld_cndt_name: string;
      cncl_cfrm_qty: string;
      cncl_yn: string;
      cpbc_ordp_infm_mthd_dvsn_cd: string;
      cpbc_ordp_mtrl_dvsn_cd: string;
      cpbc_ordp_ord_rcit_dvsn_cd: string;
      ctac_tlno: string;
      excg_dvsn_cd: string;
      excg_id_dvsn_cd: string;
      infm_tmd: string;
      inqr_ip_addr: string;
      loan_dt: string;
      odno: string;
      ord_dt: string;
      ord_dvsn_cd: string;
      ord_dvsn_name: string;
      ord_gno_brno: string;
      ord_orgno: string;
      ord_qty: string;
      ord_tmd: string;
      ord_unpr: string;
      ordr_empno: string;
      orgn_odno: string;
      pdno: string;
      prdt_name: string;
      prdt_type_cd: string;
      rjct_qty: string;
      rmn_qty: string;
      rsvn_ord_end_dt: string;
      sll_buy_dvsn_cd: string;
      sll_buy_dvsn_cd_name: string;
      stpm_cndt_pric: string;
      stpm_efct_occr_dtmd: string;
      tot_ccld_amt: string;
      tot_ccld_qty: string;
    }>;
    output2?: {
      pchs_avg_pric: string;
      prsm_tlex_smtl: string;
      tot_ccld_amt: string;
      tot_ccld_qty: string;
      tot_ord_qty: string;
    };
  };
  /** [국내주식] 기본시세 > 주식현재가 시세[v1_국내주식-008] — GET /uapi/domestic-stock/v1/quotations/inquire-price (실측 2026-11-17) */
  FHKST01010100: {
    output?: {
      acml_tr_pbmn: string;
      acml_vol: string;
      aspr_unit: string;
      bps: string;
      bstp_kor_isnm: string;
      clpr_rang_cont_yn: string;
      cpfn: string;
      cpfn_cnnm: string;
      crdt_able_yn: string;
      d250_hgpr: string;
      d250_hgpr_date: string;
      d250_hgpr_vrss_prpr_rate: string;
      d250_lwpr: string;
      d250_lwpr_date: string;
      d250_lwpr_vrss_prpr_rate: string;
      dmrs_val: string;
      dmsp_val: string;
      dryy_hgpr_date: string;
      dryy_hgpr_vrss_prpr_rate: string;
      dryy_lwpr_date: string;
      dryy_lwpr_vrss_prpr_rate: string;
      elw_pblc_yn: string;
      eps: string;
      fcam_cnnm: string;
      frgn_hldn_qty: string;
      frgn_ntby_qty: string;
      grmn_rate_cls_code: string;
      hts_avls: string;
      hts_deal_qty_unit_val: string;
      hts_frgn_ehrt: string;
      invt_caful_yn: string;
      iscd_stat_cls_code: string;
      last_ssts_cntg_qty: string;
      lstn_stcn: string;
      mang_issu_cls_code: string;
      marg_rate: string;
      mrkt_warn_cls_code: string;
      oprc_rang_cont_yn: string;
      ovtm_vi_cls_code: string;
      pbr: string;
      per: string;
      pgtr_ntby_qty: string;
      prdy_ctrt: string;
      prdy_vrss: string;
      prdy_vrss_sign: string;
      prdy_vrss_vol_rate: string;
      pvt_frst_dmrs_prc: string;
      pvt_frst_dmsp_prc: string;
      pvt_pont_val: string;
      pvt_scnd_dmrs_prc: string;
      pvt_scnd_dmsp_prc: string;
      rprs_mrkt_kor_name: string;
      rstc_wdth_prc: string;
      short_over_yn: string;
      sltr_yn: string;
      ssts_yn: string;
      stac_month: string;
      stck_dryy_hgpr: string;
      stck_dryy_lwpr: string;
      stck_fcam: string;
      stck_hgpr: string;
      stck_llam: string;
      stck_lwpr: string;
      stck_mxpr: string;
      stck_oprc: string;
      stck_prpr: string;
      stck_sdpr: string;
      stck_shrn_iscd: string;
      stck_sspr: string;
      temp_stop_yn: string;
      vi_cls_code: string;
      vol_tnrt: string;
      w52_hgpr: string;
      w52_hgpr_date: string;
      w52_hgpr_vrss_prpr_ctrt: string;
      w52_lwpr: string;
      w52_lwpr_date: string;
      w52_lwpr_vrss_prpr_ctrt: string;
      wghn_avrg_stck_prc: string;
      whol_loan_rmnd_rate: string;
    };
  };
  /** [국내주식] 업종/기타 - 종합 시황/공시(제목) — GET /uapi/domestic-stock/v1/quotations/news-title (실측 2026-11-17) */
  FHKST01011800: {
    output?: Array<{
      cntt_usiq_srno: string;
      data_dt: string;
      data_tm: string;
      dorg: string;
      hts_pbnt_titl_cntt: string;
      iscd1: string;
      iscd10: string;
      iscd2: string;
      iscd3: string;
      iscd4: string;
      iscd5: string;
      iscd6: string;
      iscd7: string;
      iscd8: string;
      iscd9: string;
      kor_isnm1: string;
      kor_isnm10: string;
      kor_isnm2: string;
      kor_isnm3: string;
      kor_isnm4: string;
      kor_isnm5: string;
      kor_isnm6: string;
      kor_isnm7: string;
      kor_isnm8: string;
      kor_isnm9: string;
      news_lrdv_code: string;
      news_ofer_entp_code: string;
    }>;
  };
  /** [국내주식] 기본시세 > ETF 구성종목시세[국내주식-073] — GET /uapi/etfetn/v1/quotations/inquire-component-stock-price (실측 2026-11-17) */
  FHKST121600C0: {
    output1?: {
      etf_cnfg_issu_avls: string;
      etf_cnfg_issu_cnt: string;
      etf_cu_unit_scrt_cnt: string;
      etf_ntas_ttam: string;
      hprc_nav: string;
      lprc_nav: string;
      nav: string;
      nav_prdy_ctrt: string;
      nav_prdy_vrss: string;
      nav_prdy_vrss_sign: string;
      oprc_nav: string;
      prdy_clpr_nav: string;
      prdy_ctrt: string;
      prdy_vrss: string;
      prdy_vrss_sign: string;
      stck_prpr: string;
    };
    output2?: Array<{
      acml_tr_pbmn: string;
      acml_vol: string;
      etf_cnfg_issu_avls: string;
      etf_cnfg_issu_rlim: string;
      etf_cu_unit_scrt_cnt: string;
      etf_vltn_amt: string;
      hts_avls: string;
      hts_kor_isnm: string;
      prdy_ctrt: string;
      prdy_vrss: string;
      prdy_vrss_sign: string;
      prdy_vrss_vol: string;
      stck_prpr: string;
      stck_shrn_iscd: string;
      tday_rsfl_rate: string;
      tr_pbmn_tnrt: string;
    }>;
  };
  /** [국내주식] 종목정보 - 국내주식 종목투자의견 — GET /uapi/domestic-stock/v1/quotations/invest-opinion (실측 2026-11-17) */
  FHKST663300C0: {
    output?: Array<{
      dprt: string;
      hts_goal_prc: string;
      invt_opnn: string;
      invt_opnn_cls_code: string;
      mbcr_name: string;
      nday_dprt: string;
      rgbf_invt_opnn: string;
      rgbf_invt_opnn_cls_code: string;
      stck_bsop_date: string;
      stck_nday_esdg: string;
      stck_prdy_clpr: string;
      stft_esdg: string;
    }>;
  };
  /** [국내주식] 종목정보 > 국내주식 재무비율 [v1_국내주식-080] — GET /uapi/domestic-stock/v1/finance/financial-ratio (실측 전(공식 예제만)) */
  FHKST66430300: {
    output?: {
      /** 실측 전 — 공식 예제 COLUMN_MAPPING */
      bps?: string;
      bsop_prfi_inrt?: string;
      eps?: string;
      grs?: string;
      lblt_rate?: string;
      ntin_inrt?: string;
      roe_val?: string;
      rsrv_rate?: string;
      sps?: string;
      stac_yymm?: string;
    } | Array<{
      /** 실측 전 — 공식 예제 COLUMN_MAPPING */
      bps?: string;
      bsop_prfi_inrt?: string;
      eps?: string;
      grs?: string;
      lblt_rate?: string;
      ntin_inrt?: string;
      roe_val?: string;
      rsrv_rate?: string;
      sps?: string;
      stac_yymm?: string;
    }>;
  };
  /** [국내주식] 기본시세 > ETF/ETN 현재가[v1_국내주식-068] — GET /uapi/etfetn/v1/quotations/inquire-price (실측 2026-11-17) */
  FHPST02400000: {
    output?: {
      acml_vol: string;
      bstp_kor_isnm: string;
      crcd: string;
      dprt: string;
      dryy_hgpr_date: string;
      dryy_hgpr_vrss_prpr_rate: string;
      dryy_lwpr_date: string;
      dryy_lwpr_vrss_prpr_rate: string;
      etf_cnfg_issu_cnt: string;
      etf_crcl_ntas_ttam: string;
      etf_crcl_stcn: string;
      etf_cu_unit_scrt_cnt: string;
      etf_div_name: string;
      etf_dvdn_cycl: string;
      etf_frcr_crcl_ntas_ttam: string;
      etf_frcr_last_ntas_wrth_val: string;
      etf_frcr_ntas_ttam: string;
      etf_ntas_ttam: string;
      etf_rprs_bstp_kor_isnm: string;
      etf_trc_ert_mltp: string;
      etf_trgt_nmix_bstp_code: string;
      frgn_hldn_qty: string;
      frgn_hldn_qty_rate: string;
      frgn_limt_rate: string;
      frgn_oder_able_qty: string;
      lp_hldn_rate: string;
      lp_hldn_vol: string;
      lp_oder_able_cls_code: string;
      lstn_stcn: string;
      mbcr_name: string;
      mtrt_date: string;
      nav: string;
      nav_prdy_ctrt: string;
      nav_prdy_vrss: string;
      nav_prdy_vrss_sign: string;
      prdy_clpr_vrss_hgpr_rate: string;
      prdy_clpr_vrss_lwpr_rate: string;
      prdy_clpr_vrss_oprc_rate: string;
      prdy_ctrt: string;
      prdy_last_nav: string;
      prdy_vol: string;
      prdy_vrss: string;
      prdy_vrss_sign: string;
      shrg_type_code: string;
      stck_dryy_hgpr: string;
      stck_dryy_lwpr: string;
      stck_hgpr: string;
      stck_llam: string;
      stck_lstn_date: string;
      stck_lwpr: string;
      stck_mxpr: string;
      stck_oprc: string;
      stck_prdy_clpr: string;
      stck_prpr: string;
      stck_sdpr: string;
      stck_sspr: string;
      trc_errt: string;
      vi_cls_code: string;
    };
  };
  /** [해외주식] 시세분석 > 해외주식 권리종합 [해외주식-050] — GET /uapi/overseas-price/v1/quotations/rights-by-ice (실측 2026-11-17) */
  HHDFS78330900: {
    output1?: Array<{
      anno_dt: string;
      ca_title: string;
      delist_dt: string;
      div_lock_dt: string;
      early_redempt_dt: string;
      effective_dt: string;
      local_end_dt: string;
      lock_dt: string;
      pay_dt: string;
      record_dt: string;
      redempt_dt: string;
      validity_dt: string;
    }>;
  };
  /** [국내주식] 종목정보 - 예탁원정보(배당일정) — GET /uapi/domestic-stock/v1/ksdinfo/dividend (실측 2026-11-17) */
  HHKDB669102C0: {
    output1?: Array<{
      divi_kind: string;
      divi_pay_dt: string;
      divi_rate: string;
      face_val: string;
      high_divi_gb: string;
      isin_name: string;
      odd_pay_dt: string;
      per_sto_divi_amt: string;
      record_date: string;
      sht_cd: string;
      stk_div_pay_dt: string;
      stk_divi_rate: string;
      stk_kind: string;
    }>;
  };
  /** [국내주식] 주문/계좌 > 주식일별주문체결조회[v1_국내주식-005] — GET /uapi/domestic-stock/v1/trading/inquire-daily-ccld (실측 2026-11-17) */
  TTTC0081R: {
    output1?: Array<{
      avg_prvs: string;
      ccld_cndt_name: string;
      cncl_cfrm_qty: string;
      cncl_yn: string;
      cpbc_ordp_infm_mthd_dvsn_cd: string;
      cpbc_ordp_mtrl_dvsn_cd: string;
      cpbc_ordp_ord_rcit_dvsn_cd: string;
      ctac_tlno: string;
      excg_dvsn_cd: string;
      excg_id_dvsn_cd: string;
      infm_tmd: string;
      inqr_ip_addr: string;
      loan_dt: string;
      odno: string;
      ord_dt: string;
      ord_dvsn_cd: string;
      ord_dvsn_name: string;
      ord_gno_brno: string;
      ord_orgno: string;
      ord_qty: string;
      ord_tmd: string;
      ord_unpr: string;
      ordr_empno: string;
      orgn_odno: string;
      pdno: string;
      prdt_name: string;
      prdt_type_cd: string;
      rjct_qty: string;
      rmn_qty: string;
      rsvn_ord_end_dt: string;
      sll_buy_dvsn_cd: string;
      sll_buy_dvsn_cd_name: string;
      stpm_cndt_pric: string;
      stpm_efct_occr_dtmd: string;
      tot_ccld_amt: string;
      tot_ccld_qty: string;
    }>;
    output2?: {
      pchs_avg_pric: string;
      prsm_tlex_smtl: string;
      tot_ccld_amt: string;
      tot_ccld_qty: string;
      tot_ord_qty: string;
    };
  };
  /** [국내주식] 주문/계좌 > 주식잔고조회[v1_국내주식-006] — GET /uapi/domestic-stock/v1/trading/inquire-balance (실측 2026-11-17) */
  TTTC8434R: {
    output1?: Array<{
      bfdy_buy_qty: string;
      bfdy_cprs_icdc: string;
      bfdy_sll_qty: string;
      evlu_amt: string;
      evlu_erng_rt: string;
      evlu_pfls_amt: string;
      evlu_pfls_rt: string;
      expd_dt: string;
      fltt_rt: string;
      grta_rt_name: string;
      hldg_qty: string;
      item_mgna_rt_name: string;
      loan_amt: string;
      loan_dt: string;
      ord_psbl_qty: string;
      pchs_amt: string;
      pchs_avg_pric: string;
      pdno: string;
      prdt_name: string;
      prpr: string;
      sbst_pric: string;
      stck_loan_unpr: string;
      stln_slng_chgs: string;
      thdt_buyqty: string;
      thdt_sll_qty: string;
      trad_dvsn_name: string;
    }>;
    output2?: Array<{
      asst_icdc_amt: string;
      asst_icdc_erng_rt: string;
      bfdy_buy_amt: string;
      bfdy_sll_amt: string;
      bfdy_tlex_amt: string;
      bfdy_tot_asst_evlu_amt: string;
      cma_evlu_amt: string;
      d2_auto_rdpt_amt: string;
      dnca_tot_amt: string;
      evlu_amt_smtl_amt: string;
      evlu_pfls_smtl_amt: string;
      fncg_gld_auto_rdpt_yn: string;
      nass_amt: string;
      nxdy_auto_rdpt_amt: string;
      nxdy_excc_amt: string;
      pchs_amt_smtl_amt: string;
      prvs_rcdl_excc_amt: string;
      scts_evlu_amt: string;
      thdt_buy_amt: string;
      thdt_sll_amt: string;
      thdt_tlex_amt: string;
      tot_evlu_amt: string;
      tot_loan_amt: string;
      tot_stln_slng_chgs: string;
    }>;
  };
  /** [국내주식] 주문/계좌 > 기간별매매손익현황조회[v1_국내주식-060] — GET /uapi/domestic-stock/v1/trading/inquire-period-trade-profit (실측 2026-11-17) */
  TTTC8715R: {
    output1?: Array<{
      buy_amt: string;
      buy_qty: string;
      fee: string;
      hldg_qty: string;
      loan_dt: string;
      loan_int: string;
      pchs_unpr: string;
      pdno: string;
      pfls_rt: string;
      prdt_name: string;
      rlzt_pfls: string;
      sll_amt: string;
      sll_pric: string;
      sll_qty: string;
      tl_tax: string;
      trad_dt: string;
      trad_dvsn_name: string;
    }>;
    output2?: {
      buy_excc_amt_smtl: string;
      buy_fee_smtl: string;
      buy_tax_smtl: string;
      buy_tr_amt_smtl: string;
      buyqty_smtl: string;
      loan_int: string;
      sll_excc_amt_smtl: string;
      sll_fee_smtl: string;
      sll_qty_smtl: string;
      sll_tltx_smtl: string;
      sll_tr_amt_smtl: string;
      tot_excc_amt: string;
      tot_fee: string;
      tot_pftrt: string;
      tot_qty: string;
      tot_rlzt_pfls: string;
      tot_tltx: string;
      tot_tr_amt: string;
    };
  };
  /** [해외주식] 주문/계좌 > 해외주식 주문체결내역 [v1_해외주식-007] — GET /uapi/overseas-stock/v1/trading/inquire-ccnl (실측 전(공식 예제만)) */
  TTTS3035R: {
    output?: Array<{
      /** 실측 전 — 공식 예제 COLUMN_MAPPING */
      dmst_ord_dt?: string;
      ft_ccld_amt3?: string;
      ft_ccld_qty?: string;
      ft_ccld_unpr3?: string;
      ft_ord_qty?: string;
      ft_ord_unpr3?: string;
      loan_dt?: string;
      loan_type_cd?: string;
      mdia_dvsn_name?: string;
      nccs_qty?: string;
      odno?: string;
      ord_dt?: string;
      ord_gno_brno?: string;
      ord_tmd?: string;
      orgn_odno?: string;
      ovrs_excg_cd?: string;
      pdno?: string;
      prcs_stat_name?: string;
      prdt_name?: string;
      rjct_rson?: string;
      rjct_rson_name?: string;
      rvse_cncl_dvsn?: string;
      rvse_cncl_dvsn_name?: string;
      sll_buy_dvsn_cd?: string;
      sll_buy_dvsn_cd_name?: string;
      splt_buy_attr_name?: string;
      thco_ord_tmd?: string;
      tr_crcy_cd?: string;
      tr_mket_name?: string;
      tr_natn?: string;
      tr_natn_name?: string;
      usa_amk_exts_rqst_yn?: string;
    }>;
  };
  /** [해외주식] 주문/계좌 > 해외주식 기간손익 [v1_해외주식-032] — GET /uapi/overseas-stock/v1/trading/inquire-period-profit (실측 2026-11-17) */
  TTTS3039R: {
    output1?: Array<{
      /** 실측 전 — 공식 예제 COLUMN_MAPPING */
      avg_sll_unpr?: string;
      frcr_pchs_amt1?: string;
      frcr_sll_amt_smtl1?: string;
      frst_bltn_exrt?: string;
      ovrs_excg_cd?: string;
      ovrs_pdno?: string;
      ovrs_rlzt_pfls_amt?: string;
      pchs_avg_pric?: string;
      pftrt?: string;
      slcl_qty?: string;
      stck_sll_tlex?: string;
      trad_day?: string;
    }>;
    output2?: {
      bass_dt: string;
      excc_dfrm_amt: string;
      exrt: string;
      ovrs_rlzt_pfls_tot_amt: string;
      smtl_fee1: string;
      stck_buy_amt_smtl: string;
      stck_sll_amt_smtl: string;
      tot_pftrt: string;
    };
  };
}

/** TR별 요청 파라미터 이름(공식 예제의 params, 대문자로 맞춤). */
export interface KisParamNames {
  CTCA0903R: "BASS_DT" | "CTX_AREA_FK" | "CTX_AREA_NK";
  CTPF1002R: "PDNO" | "PRDT_TYPE_CD";
  CTRGA011R: "ACNT_PRDT_CD" | "CANO" | "CTX_AREA_FK100" | "CTX_AREA_NK100" | "CUST_RNCNO25" | "HMID" | "INQR_DVSN" | "INQR_END_DT" | "INQR_STRT_DT" | "PDNO" | "PRDT_TYPE_CD" | "RGHT_TYPE_CD";
  CTRGT011R: "CTX_AREA_FK50" | "CTX_AREA_NK50" | "INQR_DVSN_CD" | "INQR_END_DT" | "INQR_STRT_DT" | "PDNO" | "PRDT_TYPE_CD" | "RGHT_TYPE_CD";
  CTRP6504R: "ACNT_PRDT_CD" | "CANO" | "INQR_DVSN_CD" | "NATN_CD" | "TR_MKET_CD" | "WCRC_FRCR_DVSN_CD";
  CTSC9215R: "ACNT_PRDT_CD" | "CANO" | "CCLD_DVSN" | "CTX_AREA_FK100" | "CTX_AREA_NK100" | "INQR_DVSN" | "INQR_DVSN_1" | "INQR_DVSN_3" | "INQR_END_DT" | "INQR_STRT_DT" | "ODNO" | "ORD_GNO_BRNO" | "PDNO" | "SLL_BUY_DVSN_CD";
  FHKST01010100: "FID_COND_MRKT_DIV_CODE" | "FID_INPUT_ISCD";
  FHKST01011800: "FID_COND_MRKT_CLS_CODE" | "FID_INPUT_DATE_1" | "FID_INPUT_HOUR_1" | "FID_INPUT_ISCD" | "FID_INPUT_SRNO" | "FID_NEWS_OFER_ENTP_CODE" | "FID_RANK_SORT_CLS_CODE" | "FID_TITL_CNTT";
  FHKST121600C0: "FID_COND_MRKT_DIV_CODE" | "FID_COND_SCR_DIV_CODE" | "FID_INPUT_ISCD";
  FHKST663300C0: "FID_COND_MRKT_DIV_CODE" | "FID_COND_SCR_DIV_CODE" | "FID_INPUT_DATE_1" | "FID_INPUT_DATE_2" | "FID_INPUT_ISCD";
  FHKST66430300: "FID_COND_MRKT_DIV_CODE" | "FID_DIV_CLS_CODE" | "FID_INPUT_ISCD";
  FHPST02400000: "FID_COND_MRKT_DIV_CODE" | "FID_INPUT_ISCD";
  HHDFS78330900: "ED_YMD" | "NCOD" | "ST_YMD" | "SYMB";
  HHKDB669102C0: "CTS" | "F_DT" | "GB1" | "HIGH_GB" | "SHT_CD" | "T_DT";
  TTTC0081R: "ACNT_PRDT_CD" | "CANO" | "CCLD_DVSN" | "CTX_AREA_FK100" | "CTX_AREA_NK100" | "INQR_DVSN" | "INQR_DVSN_1" | "INQR_DVSN_3" | "INQR_END_DT" | "INQR_STRT_DT" | "ODNO" | "ORD_GNO_BRNO" | "PDNO" | "SLL_BUY_DVSN_CD";
  TTTC8434R: "ACNT_PRDT_CD" | "AFHR_FLPR_YN" | "CANO" | "CTX_AREA_FK100" | "CTX_AREA_NK100" | "FNCG_AMT_AUTO_RDPT_YN" | "FUND_STTL_ICLD_YN" | "INQR_DVSN" | "OFL_YN" | "PRCS_DVSN" | "UNPR_DVSN";
  TTTC8715R: "ACNT_PRDT_CD" | "CANO" | "CBLC_DVSN" | "CTX_AREA_FK100" | "CTX_AREA_NK100" | "INQR_END_DT" | "INQR_STRT_DT" | "PDNO" | "SORT_DVSN";
  TTTS3035R: "ACNT_PRDT_CD" | "CANO" | "CCLD_NCCS_DVSN" | "CTX_AREA_FK200" | "CTX_AREA_NK200" | "ODNO" | "ORD_DT" | "ORD_END_DT" | "ORD_GNO_BRNO" | "ORD_STRT_DT" | "OVRS_EXCG_CD" | "PDNO" | "SLL_BUY_DVSN" | "SORT_SQN";
  TTTS3039R: "ACNT_PRDT_CD" | "CANO" | "CRCY_CD" | "CTX_AREA_FK200" | "CTX_AREA_NK200" | "INQR_END_DT" | "INQR_STRT_DT" | "NATN_CD" | "OVRS_EXCG_CD" | "PDNO" | "WCRC_FRCR_DVSN_CD";
}

/** 실제 응답 기록의 블록별 필드 — 앱이 응답 모양이 바뀌었는지 볼 때 쓴다(kisResponseShape.ts). */
export const KIS_LIVE_FIELDS = {
  CTCA0903R: {
    output: ["bass_dt", "bzdy_yn", "opnd_yn", "sttl_day_yn", "tr_day_yn", "wday_dvsn_cd"],
  },
  CTPF1002R: {
    output: ["admn_item_yn", "bfdy_clpr", "clpr_chng_dt", "cpta", "cptt_trad_tr_psbl_yn", "crfd_item_yn", "dpsi_aptm_erlm_yn", "dpsi_erlm_cncl_dt", "elec_scty_yn", "etf_chas_erng_rt_dbnb", "etf_cu_qty", "etf_dvsn_cd", "etf_etn_ivst_heed_item_yn", "etf_txtn_type_cd", "etf_type_cd", "excg_dvsn_cd", "frbd_mket_lstg_abol_dt", "frbd_mket_lstg_dt", "frnr_psnl_lmt_rt", "idx_bztp_lcls_cd", "idx_bztp_lcls_cd_name", "idx_bztp_mcls_cd", "idx_bztp_mcls_cd_name", "idx_bztp_scls_cd", "idx_bztp_scls_cd_name", "issu_istt_cd", "issu_pric", "kosdaq_mket_lstg_abol_dt", "kosdaq_mket_lstg_dt", "kospi200_item_yn", "lstg_abol_dt", "lstg_cptl_amt", "lstg_rqsr_issu_istt_cd", "lstg_rqsr_item_cd", "lstg_stqt", "mfnd_end_dt", "mfnd_opng_dt", "mket_id_cd", "nwst_odst_dvsn_cd", "nxt_tr_stop_yn", "ocr_no", "oilf_fund_yn", "papr", "pdno", "prdt_abrv_name", "prdt_eng_abrv_name", "prdt_eng_name", "prdt_eng_name120", "prdt_name", "prdt_name120", "prdt_type_cd", "reits_kind_cd", "sbst_pric", "scts_mket_lstg_abol_dt", "scts_mket_lstg_dt", "scty_grp_id_cd", "setl_mmdd", "stck_kind_cd", "std_idst_clsf_cd", "std_idst_clsf_cd_name", "std_pdno", "stln_int_rt_dvsn_cd", "thco_sbst_pric", "thco_sbst_pric_chng_dt", "thdt_clpr", "tr_stop_yn", "trst_istt_issu_istt_cd"],
  },
  CTRGA011R: {
    output: ["bass_dt", "cash_dfrm_dt", "cblc_qty", "dlay_int_amt", "excs_alct_qty", "last_alct_amt", "last_alct_qty", "last_ftsk_chgs", "last_ftsk_qty", "lstg_dt", "lstg_stqt", "pdno", "prdt_name", "prdt_type_cd", "rdpt_prca", "rfnd_amt", "rfnd_dt", "rght_cblc_type_cd", "rght_type_cd", "rptt_pdno", "rqst_amt", "rqst_dt", "rqst_qty", "sbsc_end_dt", "sbsc_unpr", "shtn_pdno", "tax_amt", "tot_alct_qty"],
  },
  CTRGT011R: {
    output: ["acpl_bass_dt", "alct_frcr_unpr", "bass_dt", "cash_alct_rt", "crcy_cd", "crcy_cd2", "crcy_cd3", "crcy_cd4", "dfnt_yn", "pdno", "prdt_name", "prdt_type_cd", "rght_type_cd", "sbsc_end_dt", "sbsc_strt_dt", "stck_alct_rt", "std_pdno", "stkp_dvdn_frcr_amt2", "stkp_dvdn_frcr_amt3", "stkp_dvdn_frcr_amt4"],
  },
  CTRP6504R: {
    output3: ["buy_mgn_amt", "cma_evlu_amt", "dncl_amt", "etc_mgna", "evlu_amt_smtl", "evlu_amt_smtl_amt", "evlu_erng_rt1", "evlu_pfls_amt_smtl", "frcr_evlu_tota", "frcr_use_psbl_amt", "mgna_tota", "pchs_amt_smtl", "pchs_amt_smtl_amt", "tot_asst_amt", "tot_dncl_amt", "tot_evlu_pfls_amt", "tot_frcr_cblc_smtl", "tot_loan_amt", "ustl_buy_amt_smtl", "ustl_sll_amt_smtl", "wdrw_psbl_tot_amt"],
  },
  CTSC9215R: {
    output1: ["avg_prvs", "ccld_cndt_name", "cncl_cfrm_qty", "cncl_yn", "cpbc_ordp_infm_mthd_dvsn_cd", "cpbc_ordp_mtrl_dvsn_cd", "cpbc_ordp_ord_rcit_dvsn_cd", "ctac_tlno", "excg_dvsn_cd", "excg_id_dvsn_cd", "infm_tmd", "inqr_ip_addr", "loan_dt", "odno", "ord_dt", "ord_dvsn_cd", "ord_dvsn_name", "ord_gno_brno", "ord_orgno", "ord_qty", "ord_tmd", "ord_unpr", "ordr_empno", "orgn_odno", "pdno", "prdt_name", "prdt_type_cd", "rjct_qty", "rmn_qty", "rsvn_ord_end_dt", "sll_buy_dvsn_cd", "sll_buy_dvsn_cd_name", "stpm_cndt_pric", "stpm_efct_occr_dtmd", "tot_ccld_amt", "tot_ccld_qty"],
    output2: ["pchs_avg_pric", "prsm_tlex_smtl", "tot_ccld_amt", "tot_ccld_qty", "tot_ord_qty"],
  },
  FHKST01010100: {
    output: ["acml_tr_pbmn", "acml_vol", "aspr_unit", "bps", "bstp_kor_isnm", "clpr_rang_cont_yn", "cpfn", "cpfn_cnnm", "crdt_able_yn", "d250_hgpr", "d250_hgpr_date", "d250_hgpr_vrss_prpr_rate", "d250_lwpr", "d250_lwpr_date", "d250_lwpr_vrss_prpr_rate", "dmrs_val", "dmsp_val", "dryy_hgpr_date", "dryy_hgpr_vrss_prpr_rate", "dryy_lwpr_date", "dryy_lwpr_vrss_prpr_rate", "elw_pblc_yn", "eps", "fcam_cnnm", "frgn_hldn_qty", "frgn_ntby_qty", "grmn_rate_cls_code", "hts_avls", "hts_deal_qty_unit_val", "hts_frgn_ehrt", "invt_caful_yn", "iscd_stat_cls_code", "last_ssts_cntg_qty", "lstn_stcn", "mang_issu_cls_code", "marg_rate", "mrkt_warn_cls_code", "oprc_rang_cont_yn", "ovtm_vi_cls_code", "pbr", "per", "pgtr_ntby_qty", "prdy_ctrt", "prdy_vrss", "prdy_vrss_sign", "prdy_vrss_vol_rate", "pvt_frst_dmrs_prc", "pvt_frst_dmsp_prc", "pvt_pont_val", "pvt_scnd_dmrs_prc", "pvt_scnd_dmsp_prc", "rprs_mrkt_kor_name", "rstc_wdth_prc", "short_over_yn", "sltr_yn", "ssts_yn", "stac_month", "stck_dryy_hgpr", "stck_dryy_lwpr", "stck_fcam", "stck_hgpr", "stck_llam", "stck_lwpr", "stck_mxpr", "stck_oprc", "stck_prpr", "stck_sdpr", "stck_shrn_iscd", "stck_sspr", "temp_stop_yn", "vi_cls_code", "vol_tnrt", "w52_hgpr", "w52_hgpr_date", "w52_hgpr_vrss_prpr_ctrt", "w52_lwpr", "w52_lwpr_date", "w52_lwpr_vrss_prpr_ctrt", "wghn_avrg_stck_prc", "whol_loan_rmnd_rate"],
  },
  FHKST01011800: {
    output: ["cntt_usiq_srno", "data_dt", "data_tm", "dorg", "hts_pbnt_titl_cntt", "iscd1", "iscd10", "iscd2", "iscd3", "iscd4", "iscd5", "iscd6", "iscd7", "iscd8", "iscd9", "kor_isnm1", "kor_isnm10", "kor_isnm2", "kor_isnm3", "kor_isnm4", "kor_isnm5", "kor_isnm6", "kor_isnm7", "kor_isnm8", "kor_isnm9", "news_lrdv_code", "news_ofer_entp_code"],
  },
  FHKST121600C0: {
    output1: ["etf_cnfg_issu_avls", "etf_cnfg_issu_cnt", "etf_cu_unit_scrt_cnt", "etf_ntas_ttam", "hprc_nav", "lprc_nav", "nav", "nav_prdy_ctrt", "nav_prdy_vrss", "nav_prdy_vrss_sign", "oprc_nav", "prdy_clpr_nav", "prdy_ctrt", "prdy_vrss", "prdy_vrss_sign", "stck_prpr"],
    output2: ["acml_tr_pbmn", "acml_vol", "etf_cnfg_issu_avls", "etf_cnfg_issu_rlim", "etf_cu_unit_scrt_cnt", "etf_vltn_amt", "hts_avls", "hts_kor_isnm", "prdy_ctrt", "prdy_vrss", "prdy_vrss_sign", "prdy_vrss_vol", "stck_prpr", "stck_shrn_iscd", "tday_rsfl_rate", "tr_pbmn_tnrt"],
  },
  FHKST663300C0: {
    output: ["dprt", "hts_goal_prc", "invt_opnn", "invt_opnn_cls_code", "mbcr_name", "nday_dprt", "rgbf_invt_opnn", "rgbf_invt_opnn_cls_code", "stck_bsop_date", "stck_nday_esdg", "stck_prdy_clpr", "stft_esdg"],
  },
  FHPST02400000: {
    output: ["acml_vol", "bstp_kor_isnm", "crcd", "dprt", "dryy_hgpr_date", "dryy_hgpr_vrss_prpr_rate", "dryy_lwpr_date", "dryy_lwpr_vrss_prpr_rate", "etf_cnfg_issu_cnt", "etf_crcl_ntas_ttam", "etf_crcl_stcn", "etf_cu_unit_scrt_cnt", "etf_div_name", "etf_dvdn_cycl", "etf_frcr_crcl_ntas_ttam", "etf_frcr_last_ntas_wrth_val", "etf_frcr_ntas_ttam", "etf_ntas_ttam", "etf_rprs_bstp_kor_isnm", "etf_trc_ert_mltp", "etf_trgt_nmix_bstp_code", "frgn_hldn_qty", "frgn_hldn_qty_rate", "frgn_limt_rate", "frgn_oder_able_qty", "lp_hldn_rate", "lp_hldn_vol", "lp_oder_able_cls_code", "lstn_stcn", "mbcr_name", "mtrt_date", "nav", "nav_prdy_ctrt", "nav_prdy_vrss", "nav_prdy_vrss_sign", "prdy_clpr_vrss_hgpr_rate", "prdy_clpr_vrss_lwpr_rate", "prdy_clpr_vrss_oprc_rate", "prdy_ctrt", "prdy_last_nav", "prdy_vol", "prdy_vrss", "prdy_vrss_sign", "shrg_type_code", "stck_dryy_hgpr", "stck_dryy_lwpr", "stck_hgpr", "stck_llam", "stck_lstn_date", "stck_lwpr", "stck_mxpr", "stck_oprc", "stck_prdy_clpr", "stck_prpr", "stck_sdpr", "stck_sspr", "trc_errt", "vi_cls_code"],
  },
  HHDFS78330900: {
    output1: ["anno_dt", "ca_title", "delist_dt", "div_lock_dt", "early_redempt_dt", "effective_dt", "local_end_dt", "lock_dt", "pay_dt", "record_dt", "redempt_dt", "validity_dt"],
  },
  HHKDB669102C0: {
    output1: ["divi_kind", "divi_pay_dt", "divi_rate", "face_val", "high_divi_gb", "isin_name", "odd_pay_dt", "per_sto_divi_amt", "record_date", "sht_cd", "stk_div_pay_dt", "stk_divi_rate", "stk_kind"],
  },
  TTTC0081R: {
    output1: ["avg_prvs", "ccld_cndt_name", "cncl_cfrm_qty", "cncl_yn", "cpbc_ordp_infm_mthd_dvsn_cd", "cpbc_ordp_mtrl_dvsn_cd", "cpbc_ordp_ord_rcit_dvsn_cd", "ctac_tlno", "excg_dvsn_cd", "excg_id_dvsn_cd", "infm_tmd", "inqr_ip_addr", "loan_dt", "odno", "ord_dt", "ord_dvsn_cd", "ord_dvsn_name", "ord_gno_brno", "ord_orgno", "ord_qty", "ord_tmd", "ord_unpr", "ordr_empno", "orgn_odno", "pdno", "prdt_name", "prdt_type_cd", "rjct_qty", "rmn_qty", "rsvn_ord_end_dt", "sll_buy_dvsn_cd", "sll_buy_dvsn_cd_name", "stpm_cndt_pric", "stpm_efct_occr_dtmd", "tot_ccld_amt", "tot_ccld_qty"],
    output2: ["pchs_avg_pric", "prsm_tlex_smtl", "tot_ccld_amt", "tot_ccld_qty", "tot_ord_qty"],
  },
  TTTC8434R: {
    output1: ["bfdy_buy_qty", "bfdy_cprs_icdc", "bfdy_sll_qty", "evlu_amt", "evlu_erng_rt", "evlu_pfls_amt", "evlu_pfls_rt", "expd_dt", "fltt_rt", "grta_rt_name", "hldg_qty", "item_mgna_rt_name", "loan_amt", "loan_dt", "ord_psbl_qty", "pchs_amt", "pchs_avg_pric", "pdno", "prdt_name", "prpr", "sbst_pric", "stck_loan_unpr", "stln_slng_chgs", "thdt_buyqty", "thdt_sll_qty", "trad_dvsn_name"],
    output2: ["asst_icdc_amt", "asst_icdc_erng_rt", "bfdy_buy_amt", "bfdy_sll_amt", "bfdy_tlex_amt", "bfdy_tot_asst_evlu_amt", "cma_evlu_amt", "d2_auto_rdpt_amt", "dnca_tot_amt", "evlu_amt_smtl_amt", "evlu_pfls_smtl_amt", "fncg_gld_auto_rdpt_yn", "nass_amt", "nxdy_auto_rdpt_amt", "nxdy_excc_amt", "pchs_amt_smtl_amt", "prvs_rcdl_excc_amt", "scts_evlu_amt", "thdt_buy_amt", "thdt_sll_amt", "thdt_tlex_amt", "tot_evlu_amt", "tot_loan_amt", "tot_stln_slng_chgs"],
  },
  TTTC8715R: {
    output1: ["buy_amt", "buy_qty", "fee", "hldg_qty", "loan_dt", "loan_int", "pchs_unpr", "pdno", "pfls_rt", "prdt_name", "rlzt_pfls", "sll_amt", "sll_pric", "sll_qty", "tl_tax", "trad_dt", "trad_dvsn_name"],
    output2: ["buy_excc_amt_smtl", "buy_fee_smtl", "buy_tax_smtl", "buy_tr_amt_smtl", "buyqty_smtl", "loan_int", "sll_excc_amt_smtl", "sll_fee_smtl", "sll_qty_smtl", "sll_tltx_smtl", "sll_tr_amt_smtl", "tot_excc_amt", "tot_fee", "tot_pftrt", "tot_qty", "tot_rlzt_pfls", "tot_tltx", "tot_tr_amt"],
  },
  TTTS3039R: {
    output2: ["bass_dt", "excc_dfrm_amt", "exrt", "ovrs_rlzt_pfls_tot_amt", "smtl_fee1", "stck_buy_amt_smtl", "stck_sll_amt_smtl", "tot_pftrt"],
  },
} as const;
