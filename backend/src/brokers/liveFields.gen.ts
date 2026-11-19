// ⚠ 자동 생성 파일 — 직접 고치지 말 것. `npm run spec:types`가 backend/spec/snapshots/<증권사>-live.json(실제 응답 기록)에서 만든다.
// 블록별 필드 이름만(값 없음). 앱이 응답을 받을 때 여기 있던 필드가 빠지면 로그에 한 번 경고한다(brokers/responseShape.ts).
/* eslint-disable */

export const LIVE_FIELDS: Record<string, { recordedAt: string; fields: Record<string, Record<string, readonly string[]>> }> = {
  "kb": {
    "fields": {
      "SIQM4900": {
        "dataBody": [
          "dl_crncy_clsf_nm",
          "dmstc_clsf_nm",
          "eng_is_nm",
          "eng_is_nm2",
          "eng_shrt_nm",
          "eng_shrt_nm2",
          "gds_rprst_cd",
          "hngl_is_nm",
          "hngl_is_nm2",
          "hngl_shrt_nm",
          "hngl_shrt_nm2",
          "io_rstn_clsf_nm",
          "io_rstn_end_dt",
          "io_rstn_strt_dt",
          "is_dtl_typ_cd",
          "is_dtl_typ_nm",
          "is_rgst_clsf_nm",
          "is_typ_cd",
          "is_typ_nm",
          "lnd_clsf_nm",
          "o_clsf",
          "o_lngth",
          "o_msg",
          "rsk_grd_clsf_cd",
          "rsk_grd_nm",
          "shrt_is_cd",
          "slf_is_cd",
          "stnd_is_cd",
          "symbl_is_cd",
          "trd_rstn_clsf_nm",
          "trd_rstn_end_dt",
          "trd_rstn_strt_dt"
        ],
        "dataHeader": [
          "processCode",
          "processFlag",
          "processMessage",
          "processTime",
          "resultCode",
          "resultMessage"
        ]
      },
      "SSQM2952": {
        "dataBody": [
          "Record1",
          "brwg_mrtg_csh_est_amt",
          "brwg_nd_mrtg_amt",
          "byng_amt_sum",
          "cma_pldg_est_amt",
          "dy_tfnd",
          "elw_excs_mgn",
          "etc_lndng_amt",
          "fcrncy_tfnd_krw_exch_amt",
          "fncng_amt",
          "fncng_amt_sum",
          "gnl_ln_amt",
          "grid_cnt1",
          "itst_npymt_amt",
          "mrtg_rt",
          "mrtg_shrtg_amt",
          "ndy_o_amt_psbl_amt",
          "ndy_tfnd",
          "nrfnd_fncng_amt",
          "nt_asts_val_amt",
          "nt_byng_amt",
          "nxt2_dy_o_amt_psbl_amt",
          "nxt2_dy_tfnd",
          "o_clsf",
          "o_lngth",
          "o_msg",
          "scrts_nt_val_amt",
          "tl_data_cnt",
          "val_amt_sum",
          "val_pl",
          "val_pl_sum",
          "val_yld",
          "val_yld_sum"
        ],
        "dataHeader": [
          "processCode",
          "processFlag",
          "processMessage",
          "processTime",
          "resultCode",
          "resultMessage"
        ]
      },
      "SWQA2301": {
        "dataBody": [
          "Record1",
          "grid_cnt1",
          "nxt_key",
          "o_clsf",
          "o_lngth",
          "o_msg"
        ],
        "dataHeader": [
          "processCode",
          "processFlag",
          "processMessage",
          "processTime",
          "resultCode",
          "resultMessage"
        ]
      }
    },
    "recordedAt": "2026-11-17"
  },
  "kis": {
    "fields": {
      "CTCA0903R": {
        "output": [
          "bass_dt",
          "bzdy_yn",
          "opnd_yn",
          "sttl_day_yn",
          "tr_day_yn",
          "wday_dvsn_cd"
        ]
      },
      "CTPF1002R": {
        "output": [
          "admn_item_yn",
          "bfdy_clpr",
          "clpr_chng_dt",
          "cpta",
          "cptt_trad_tr_psbl_yn",
          "crfd_item_yn",
          "dpsi_aptm_erlm_yn",
          "dpsi_erlm_cncl_dt",
          "elec_scty_yn",
          "etf_chas_erng_rt_dbnb",
          "etf_cu_qty",
          "etf_dvsn_cd",
          "etf_etn_ivst_heed_item_yn",
          "etf_txtn_type_cd",
          "etf_type_cd",
          "excg_dvsn_cd",
          "frbd_mket_lstg_abol_dt",
          "frbd_mket_lstg_dt",
          "frnr_psnl_lmt_rt",
          "idx_bztp_lcls_cd",
          "idx_bztp_lcls_cd_name",
          "idx_bztp_mcls_cd",
          "idx_bztp_mcls_cd_name",
          "idx_bztp_scls_cd",
          "idx_bztp_scls_cd_name",
          "issu_istt_cd",
          "issu_pric",
          "kosdaq_mket_lstg_abol_dt",
          "kosdaq_mket_lstg_dt",
          "kospi200_item_yn",
          "lstg_abol_dt",
          "lstg_cptl_amt",
          "lstg_rqsr_issu_istt_cd",
          "lstg_rqsr_item_cd",
          "lstg_stqt",
          "mfnd_end_dt",
          "mfnd_opng_dt",
          "mket_id_cd",
          "nwst_odst_dvsn_cd",
          "nxt_tr_stop_yn",
          "ocr_no",
          "oilf_fund_yn",
          "papr",
          "pdno",
          "prdt_abrv_name",
          "prdt_eng_abrv_name",
          "prdt_eng_name",
          "prdt_eng_name120",
          "prdt_name",
          "prdt_name120",
          "prdt_type_cd",
          "reits_kind_cd",
          "sbst_pric",
          "scts_mket_lstg_abol_dt",
          "scts_mket_lstg_dt",
          "scty_grp_id_cd",
          "setl_mmdd",
          "stck_kind_cd",
          "std_idst_clsf_cd",
          "std_idst_clsf_cd_name",
          "std_pdno",
          "stln_int_rt_dvsn_cd",
          "thco_sbst_pric",
          "thco_sbst_pric_chng_dt",
          "thdt_clpr",
          "tr_stop_yn",
          "trst_istt_issu_istt_cd"
        ]
      },
      "CTRGA011R": {
        "output": [
          "bass_dt",
          "cash_dfrm_dt",
          "cblc_qty",
          "dlay_int_amt",
          "excs_alct_qty",
          "last_alct_amt",
          "last_alct_qty",
          "last_ftsk_chgs",
          "last_ftsk_qty",
          "lstg_dt",
          "lstg_stqt",
          "pdno",
          "prdt_name",
          "prdt_type_cd",
          "rdpt_prca",
          "rfnd_amt",
          "rfnd_dt",
          "rght_cblc_type_cd",
          "rght_type_cd",
          "rptt_pdno",
          "rqst_amt",
          "rqst_dt",
          "rqst_qty",
          "sbsc_end_dt",
          "sbsc_unpr",
          "shtn_pdno",
          "tax_amt",
          "tot_alct_qty"
        ]
      },
      "CTRGT011R": {
        "output": [
          "acpl_bass_dt",
          "alct_frcr_unpr",
          "bass_dt",
          "cash_alct_rt",
          "crcy_cd",
          "crcy_cd2",
          "crcy_cd3",
          "crcy_cd4",
          "dfnt_yn",
          "pdno",
          "prdt_name",
          "prdt_type_cd",
          "rght_type_cd",
          "sbsc_end_dt",
          "sbsc_strt_dt",
          "stck_alct_rt",
          "std_pdno",
          "stkp_dvdn_frcr_amt2",
          "stkp_dvdn_frcr_amt3",
          "stkp_dvdn_frcr_amt4"
        ]
      },
      "CTRP6504R": {
        "output3": [
          "buy_mgn_amt",
          "cma_evlu_amt",
          "dncl_amt",
          "etc_mgna",
          "evlu_amt_smtl",
          "evlu_amt_smtl_amt",
          "evlu_erng_rt1",
          "evlu_pfls_amt_smtl",
          "frcr_evlu_tota",
          "frcr_use_psbl_amt",
          "mgna_tota",
          "pchs_amt_smtl",
          "pchs_amt_smtl_amt",
          "tot_asst_amt",
          "tot_dncl_amt",
          "tot_evlu_pfls_amt",
          "tot_frcr_cblc_smtl",
          "tot_loan_amt",
          "ustl_buy_amt_smtl",
          "ustl_sll_amt_smtl",
          "wdrw_psbl_tot_amt"
        ]
      },
      "CTSC9215R": {
        "output1": [
          "avg_prvs",
          "ccld_cndt_name",
          "cncl_cfrm_qty",
          "cncl_yn",
          "cpbc_ordp_infm_mthd_dvsn_cd",
          "cpbc_ordp_mtrl_dvsn_cd",
          "cpbc_ordp_ord_rcit_dvsn_cd",
          "ctac_tlno",
          "excg_dvsn_cd",
          "excg_id_dvsn_cd",
          "infm_tmd",
          "inqr_ip_addr",
          "loan_dt",
          "odno",
          "ord_dt",
          "ord_dvsn_cd",
          "ord_dvsn_name",
          "ord_gno_brno",
          "ord_orgno",
          "ord_qty",
          "ord_tmd",
          "ord_unpr",
          "ordr_empno",
          "orgn_odno",
          "pdno",
          "prdt_name",
          "prdt_type_cd",
          "rjct_qty",
          "rmn_qty",
          "rsvn_ord_end_dt",
          "sll_buy_dvsn_cd",
          "sll_buy_dvsn_cd_name",
          "stpm_cndt_pric",
          "stpm_efct_occr_dtmd",
          "tot_ccld_amt",
          "tot_ccld_qty"
        ],
        "output2": [
          "pchs_avg_pric",
          "prsm_tlex_smtl",
          "tot_ccld_amt",
          "tot_ccld_qty",
          "tot_ord_qty"
        ]
      },
      "FHKST01010100": {
        "output": [
          "acml_tr_pbmn",
          "acml_vol",
          "aspr_unit",
          "bps",
          "bstp_kor_isnm",
          "clpr_rang_cont_yn",
          "cpfn",
          "cpfn_cnnm",
          "crdt_able_yn",
          "d250_hgpr",
          "d250_hgpr_date",
          "d250_hgpr_vrss_prpr_rate",
          "d250_lwpr",
          "d250_lwpr_date",
          "d250_lwpr_vrss_prpr_rate",
          "dmrs_val",
          "dmsp_val",
          "dryy_hgpr_date",
          "dryy_hgpr_vrss_prpr_rate",
          "dryy_lwpr_date",
          "dryy_lwpr_vrss_prpr_rate",
          "elw_pblc_yn",
          "eps",
          "fcam_cnnm",
          "frgn_hldn_qty",
          "frgn_ntby_qty",
          "grmn_rate_cls_code",
          "hts_avls",
          "hts_deal_qty_unit_val",
          "hts_frgn_ehrt",
          "invt_caful_yn",
          "iscd_stat_cls_code",
          "last_ssts_cntg_qty",
          "lstn_stcn",
          "mang_issu_cls_code",
          "marg_rate",
          "mrkt_warn_cls_code",
          "oprc_rang_cont_yn",
          "ovtm_vi_cls_code",
          "pbr",
          "per",
          "pgtr_ntby_qty",
          "prdy_ctrt",
          "prdy_vrss",
          "prdy_vrss_sign",
          "prdy_vrss_vol_rate",
          "pvt_frst_dmrs_prc",
          "pvt_frst_dmsp_prc",
          "pvt_pont_val",
          "pvt_scnd_dmrs_prc",
          "pvt_scnd_dmsp_prc",
          "rprs_mrkt_kor_name",
          "rstc_wdth_prc",
          "short_over_yn",
          "sltr_yn",
          "ssts_yn",
          "stac_month",
          "stck_dryy_hgpr",
          "stck_dryy_lwpr",
          "stck_fcam",
          "stck_hgpr",
          "stck_llam",
          "stck_lwpr",
          "stck_mxpr",
          "stck_oprc",
          "stck_prpr",
          "stck_sdpr",
          "stck_shrn_iscd",
          "stck_sspr",
          "temp_stop_yn",
          "vi_cls_code",
          "vol_tnrt",
          "w52_hgpr",
          "w52_hgpr_date",
          "w52_hgpr_vrss_prpr_ctrt",
          "w52_lwpr",
          "w52_lwpr_date",
          "w52_lwpr_vrss_prpr_ctrt",
          "wghn_avrg_stck_prc",
          "whol_loan_rmnd_rate"
        ]
      },
      "FHKST01011800": {
        "output": [
          "cntt_usiq_srno",
          "data_dt",
          "data_tm",
          "dorg",
          "hts_pbnt_titl_cntt",
          "iscd1",
          "iscd10",
          "iscd2",
          "iscd3",
          "iscd4",
          "iscd5",
          "iscd6",
          "iscd7",
          "iscd8",
          "iscd9",
          "kor_isnm1",
          "kor_isnm10",
          "kor_isnm2",
          "kor_isnm3",
          "kor_isnm4",
          "kor_isnm5",
          "kor_isnm6",
          "kor_isnm7",
          "kor_isnm8",
          "kor_isnm9",
          "news_lrdv_code",
          "news_ofer_entp_code"
        ]
      },
      "FHKST121600C0": {
        "output1": [
          "etf_cnfg_issu_avls",
          "etf_cnfg_issu_cnt",
          "etf_cu_unit_scrt_cnt",
          "etf_ntas_ttam",
          "hprc_nav",
          "lprc_nav",
          "nav",
          "nav_prdy_ctrt",
          "nav_prdy_vrss",
          "nav_prdy_vrss_sign",
          "oprc_nav",
          "prdy_clpr_nav",
          "prdy_ctrt",
          "prdy_vrss",
          "prdy_vrss_sign",
          "stck_prpr"
        ],
        "output2": [
          "acml_tr_pbmn",
          "acml_vol",
          "etf_cnfg_issu_avls",
          "etf_cnfg_issu_rlim",
          "etf_cu_unit_scrt_cnt",
          "etf_vltn_amt",
          "hts_avls",
          "hts_kor_isnm",
          "prdy_ctrt",
          "prdy_vrss",
          "prdy_vrss_sign",
          "prdy_vrss_vol",
          "stck_prpr",
          "stck_shrn_iscd",
          "tday_rsfl_rate",
          "tr_pbmn_tnrt"
        ]
      },
      "FHKST663300C0": {
        "output": [
          "dprt",
          "hts_goal_prc",
          "invt_opnn",
          "invt_opnn_cls_code",
          "mbcr_name",
          "nday_dprt",
          "rgbf_invt_opnn",
          "rgbf_invt_opnn_cls_code",
          "stck_bsop_date",
          "stck_nday_esdg",
          "stck_prdy_clpr",
          "stft_esdg"
        ]
      },
      "FHPST02400000": {
        "output": [
          "acml_vol",
          "bstp_kor_isnm",
          "crcd",
          "dprt",
          "dryy_hgpr_date",
          "dryy_hgpr_vrss_prpr_rate",
          "dryy_lwpr_date",
          "dryy_lwpr_vrss_prpr_rate",
          "etf_cnfg_issu_cnt",
          "etf_crcl_ntas_ttam",
          "etf_crcl_stcn",
          "etf_cu_unit_scrt_cnt",
          "etf_div_name",
          "etf_dvdn_cycl",
          "etf_frcr_crcl_ntas_ttam",
          "etf_frcr_last_ntas_wrth_val",
          "etf_frcr_ntas_ttam",
          "etf_ntas_ttam",
          "etf_rprs_bstp_kor_isnm",
          "etf_trc_ert_mltp",
          "etf_trgt_nmix_bstp_code",
          "frgn_hldn_qty",
          "frgn_hldn_qty_rate",
          "frgn_limt_rate",
          "frgn_oder_able_qty",
          "lp_hldn_rate",
          "lp_hldn_vol",
          "lp_oder_able_cls_code",
          "lstn_stcn",
          "mbcr_name",
          "mtrt_date",
          "nav",
          "nav_prdy_ctrt",
          "nav_prdy_vrss",
          "nav_prdy_vrss_sign",
          "prdy_clpr_vrss_hgpr_rate",
          "prdy_clpr_vrss_lwpr_rate",
          "prdy_clpr_vrss_oprc_rate",
          "prdy_ctrt",
          "prdy_last_nav",
          "prdy_vol",
          "prdy_vrss",
          "prdy_vrss_sign",
          "shrg_type_code",
          "stck_dryy_hgpr",
          "stck_dryy_lwpr",
          "stck_hgpr",
          "stck_llam",
          "stck_lstn_date",
          "stck_lwpr",
          "stck_mxpr",
          "stck_oprc",
          "stck_prdy_clpr",
          "stck_prpr",
          "stck_sdpr",
          "stck_sspr",
          "trc_errt",
          "vi_cls_code"
        ]
      },
      "HHDFS76200200": {
        "output": [
          "base",
          "bpsx",
          "curr",
          "dnlp",
          "e_hogau",
          "e_icod",
          "e_ordyn",
          "e_parp",
          "epsx",
          "etyp_nm",
          "h52d",
          "h52p",
          "high",
          "l52d",
          "l52p",
          "last",
          "low",
          "mcap",
          "open",
          "p_rate",
          "p_xdif",
          "p_xprc",
          "p_xrat",
          "p_xsng",
          "pamt",
          "pbrx",
          "perx",
          "pvol",
          "rsym",
          "shar",
          "t_rate",
          "t_xdif",
          "t_xprc",
          "t_xrat",
          "t_xsgn",
          "tamt",
          "tomv",
          "tvol",
          "uplp",
          "vnit",
          "zdiv"
        ]
      },
      "HHDFS78330900": {
        "output1": [
          "anno_dt",
          "ca_title",
          "delist_dt",
          "div_lock_dt",
          "early_redempt_dt",
          "effective_dt",
          "local_end_dt",
          "lock_dt",
          "pay_dt",
          "record_dt",
          "redempt_dt",
          "validity_dt"
        ]
      },
      "HHKDB669102C0": {
        "output1": [
          "divi_kind",
          "divi_pay_dt",
          "divi_rate",
          "face_val",
          "high_divi_gb",
          "isin_name",
          "odd_pay_dt",
          "per_sto_divi_amt",
          "record_date",
          "sht_cd",
          "stk_div_pay_dt",
          "stk_divi_rate",
          "stk_kind"
        ]
      },
      "TTTC0081R": {
        "output1": [
          "avg_prvs",
          "ccld_cndt_name",
          "cncl_cfrm_qty",
          "cncl_yn",
          "cpbc_ordp_infm_mthd_dvsn_cd",
          "cpbc_ordp_mtrl_dvsn_cd",
          "cpbc_ordp_ord_rcit_dvsn_cd",
          "ctac_tlno",
          "excg_dvsn_cd",
          "excg_id_dvsn_cd",
          "infm_tmd",
          "inqr_ip_addr",
          "loan_dt",
          "odno",
          "ord_dt",
          "ord_dvsn_cd",
          "ord_dvsn_name",
          "ord_gno_brno",
          "ord_orgno",
          "ord_qty",
          "ord_tmd",
          "ord_unpr",
          "ordr_empno",
          "orgn_odno",
          "pdno",
          "prdt_name",
          "prdt_type_cd",
          "rjct_qty",
          "rmn_qty",
          "rsvn_ord_end_dt",
          "sll_buy_dvsn_cd",
          "sll_buy_dvsn_cd_name",
          "stpm_cndt_pric",
          "stpm_efct_occr_dtmd",
          "tot_ccld_amt",
          "tot_ccld_qty"
        ],
        "output2": [
          "pchs_avg_pric",
          "prsm_tlex_smtl",
          "tot_ccld_amt",
          "tot_ccld_qty",
          "tot_ord_qty"
        ]
      },
      "TTTC8434R": {
        "output1": [
          "bfdy_buy_qty",
          "bfdy_cprs_icdc",
          "bfdy_sll_qty",
          "evlu_amt",
          "evlu_erng_rt",
          "evlu_pfls_amt",
          "evlu_pfls_rt",
          "expd_dt",
          "fltt_rt",
          "grta_rt_name",
          "hldg_qty",
          "item_mgna_rt_name",
          "loan_amt",
          "loan_dt",
          "ord_psbl_qty",
          "pchs_amt",
          "pchs_avg_pric",
          "pdno",
          "prdt_name",
          "prpr",
          "sbst_pric",
          "stck_loan_unpr",
          "stln_slng_chgs",
          "thdt_buyqty",
          "thdt_sll_qty",
          "trad_dvsn_name"
        ],
        "output2": [
          "asst_icdc_amt",
          "asst_icdc_erng_rt",
          "bfdy_buy_amt",
          "bfdy_sll_amt",
          "bfdy_tlex_amt",
          "bfdy_tot_asst_evlu_amt",
          "cma_evlu_amt",
          "d2_auto_rdpt_amt",
          "dnca_tot_amt",
          "evlu_amt_smtl_amt",
          "evlu_pfls_smtl_amt",
          "fncg_gld_auto_rdpt_yn",
          "nass_amt",
          "nxdy_auto_rdpt_amt",
          "nxdy_excc_amt",
          "pchs_amt_smtl_amt",
          "prvs_rcdl_excc_amt",
          "scts_evlu_amt",
          "thdt_buy_amt",
          "thdt_sll_amt",
          "thdt_tlex_amt",
          "tot_evlu_amt",
          "tot_loan_amt",
          "tot_stln_slng_chgs"
        ]
      },
      "TTTC8715R": {
        "output1": [
          "buy_amt",
          "buy_qty",
          "fee",
          "hldg_qty",
          "loan_dt",
          "loan_int",
          "pchs_unpr",
          "pdno",
          "pfls_rt",
          "prdt_name",
          "rlzt_pfls",
          "sll_amt",
          "sll_pric",
          "sll_qty",
          "tl_tax",
          "trad_dt",
          "trad_dvsn_name"
        ],
        "output2": [
          "buy_excc_amt_smtl",
          "buy_fee_smtl",
          "buy_tax_smtl",
          "buy_tr_amt_smtl",
          "buyqty_smtl",
          "loan_int",
          "sll_excc_amt_smtl",
          "sll_fee_smtl",
          "sll_qty_smtl",
          "sll_tltx_smtl",
          "sll_tr_amt_smtl",
          "tot_excc_amt",
          "tot_fee",
          "tot_pftrt",
          "tot_qty",
          "tot_rlzt_pfls",
          "tot_tltx",
          "tot_tr_amt"
        ]
      },
      "TTTS3039R": {
        "output2": [
          "bass_dt",
          "excc_dfrm_amt",
          "exrt",
          "ovrs_rlzt_pfls_tot_amt",
          "smtl_fee1",
          "stck_buy_amt_smtl",
          "stck_sll_amt_smtl",
          "tot_pftrt"
        ]
      }
    },
    "recordedAt": "2026-11-19"
  },
  "nh": {
    "fields": {
      "/gbstock/inquiry/v1/balance": {
        "Output_0": [
          "abk_amt",
          "eal_amt_sum",
          "eal_pls_sum_amt",
          "fc_abk_amt",
          "fc_aet_amt",
          "fc_dca",
          "fc_eal_amt",
          "fc_eal_pls_amt",
          "fc_ny_stl_xcl_amt",
          "krw_dca",
          "krw_ny_stl_xcl_amt",
          "krw_pft_rt",
          "pft_rt",
          "ptps_ttn_amt",
          "ptps_ttn_amt1",
          "tot_aet_amt"
        ]
      },
      "/gbstock/inquiry/v1/dailyTransaction": {
        "Output_1": [
          "amt_sum",
          "drn_tal",
          "fee_sum_amt",
          "rpm_tal",
          "tax_sum_amt"
        ]
      },
      "/gbstock/inquiry/v1/periodPnl": {
        "Output_0": [
          "byn_qty_sum",
          "fc_byn_amt_sum",
          "fc_rzt_pft_rt",
          "fc_rzt_pls_sum",
          "fc_sby_pft_rt",
          "fc_sby_pls_sum",
          "fc_sdr_xps_sum",
          "fc_sll_amt_sum",
          "sll_qty_sum"
        ]
      },
      "/krstock/inquiry/v1/balance": {
        "Output_0": [
          "act_atv_tp_dtl_cd",
          "cfd_pdt_tp_nm",
          "csh_wtm",
          "dca",
          "drn_pbl_amt",
          "ect_lga",
          "int_ny_pmt_amt",
          "lon_amt",
          "mgg_rt",
          "nas_amt",
          "nxt2_dd_dca",
          "nxt_dd_dca",
          "ny_rdp_amt",
          "orr_pbl_amt1",
          "orr_pbl_amt2",
          "orr_pbl_amt3",
          "orr_pbl_amt4",
          "pft_rt",
          "rba",
          "sba_amt",
          "sba_wtm",
          "sll_edn_amt",
          "slo_mgg_amt",
          "tot_aet_amt",
          "tot_byn_amt",
          "tot_eal_amt",
          "tot_eal_pls"
        ]
      },
      "/krstock/inquiry/v1/tradingPnl": {
        "Output_0": [
          "byn_amt",
          "byn_cnt",
          "byn_fee",
          "byn_qty",
          "pft_rt",
          "pls_amt",
          "sll_abk_amt",
          "sll_amt",
          "sll_cnt",
          "sll_qty",
          "sll_tax_sum"
        ]
      },
      "/n2/acctinfo": {
        "Output_0": [
          "acct_no",
          "acct_type"
        ]
      }
    },
    "recordedAt": "2026-11-17"
  },
  "toss": {
    "fields": {
      "/api/v1/accounts": {
        "result": [
          "accountNo",
          "accountSeq",
          "accountType"
        ]
      },
      "/api/v1/buying-power": {
        "result": [
          "cashBuyingPower",
          "currency"
        ]
      },
      "/api/v1/candles": {
        "result": [
          "candles",
          "nextBefore"
        ],
        "result.candles": [
          "closePrice",
          "currency",
          "highPrice",
          "lowPrice",
          "openPrice",
          "timestamp",
          "volume"
        ]
      },
      "/api/v1/exchange-rate": {
        "result": [
          "baseCurrency",
          "basisPoint",
          "midRate",
          "quoteCurrency",
          "rate",
          "rateChangeType",
          "validFrom",
          "validUntil"
        ]
      },
      "/api/v1/holdings": {
        "result": [
          "dailyProfitLoss",
          "items",
          "marketValue",
          "profitLoss",
          "totalPurchaseAmount"
        ],
        "result.dailyProfitLoss": [
          "amount",
          "rate"
        ],
        "result.dailyProfitLoss.amount": [
          "krw",
          "usd"
        ],
        "result.items": [
          "averagePurchasePrice",
          "cost",
          "currency",
          "dailyProfitLoss",
          "lastPrice",
          "marketCountry",
          "marketValue",
          "name",
          "profitLoss",
          "quantity",
          "symbol"
        ],
        "result.items.cost": [
          "commission",
          "tax"
        ],
        "result.items.dailyProfitLoss": [
          "amount",
          "rate"
        ],
        "result.items.marketValue": [
          "amount",
          "amountAfterCost",
          "purchaseAmount"
        ],
        "result.items.profitLoss": [
          "amount",
          "amountAfterCost",
          "rate",
          "rateAfterCost"
        ],
        "result.marketValue": [
          "amount",
          "amountAfterCost"
        ],
        "result.marketValue.amount": [
          "krw",
          "usd"
        ],
        "result.marketValue.amountAfterCost": [
          "krw",
          "usd"
        ],
        "result.profitLoss": [
          "amount",
          "amountAfterCost",
          "rate",
          "rateAfterCost"
        ],
        "result.profitLoss.amount": [
          "krw",
          "usd"
        ],
        "result.profitLoss.amountAfterCost": [
          "krw",
          "usd"
        ],
        "result.totalPurchaseAmount": [
          "krw",
          "usd"
        ]
      },
      "/api/v1/market-calendar/KR": {
        "result": [
          "nextBusinessDay",
          "previousBusinessDay",
          "today"
        ],
        "result.nextBusinessDay": [
          "date",
          "integrated"
        ],
        "result.nextBusinessDay.integrated": [
          "afterMarket",
          "preMarket",
          "regularMarket"
        ],
        "result.nextBusinessDay.integrated.afterMarket": [
          "endTime",
          "singlePriceAuctionEndTime",
          "startTime"
        ],
        "result.nextBusinessDay.integrated.preMarket": [
          "endTime",
          "singlePriceAuctionStartTime",
          "startTime"
        ],
        "result.nextBusinessDay.integrated.regularMarket": [
          "endTime",
          "singlePriceAuctionStartTime",
          "startTime"
        ],
        "result.previousBusinessDay": [
          "date",
          "integrated"
        ],
        "result.previousBusinessDay.integrated": [
          "afterMarket",
          "preMarket",
          "regularMarket"
        ],
        "result.previousBusinessDay.integrated.afterMarket": [
          "endTime",
          "singlePriceAuctionEndTime",
          "startTime"
        ],
        "result.previousBusinessDay.integrated.preMarket": [
          "endTime",
          "singlePriceAuctionStartTime",
          "startTime"
        ],
        "result.previousBusinessDay.integrated.regularMarket": [
          "endTime",
          "singlePriceAuctionStartTime",
          "startTime"
        ],
        "result.today": [
          "date",
          "integrated"
        ],
        "result.today.integrated": [
          "afterMarket",
          "preMarket",
          "regularMarket"
        ],
        "result.today.integrated.afterMarket": [
          "endTime",
          "singlePriceAuctionEndTime",
          "startTime"
        ],
        "result.today.integrated.preMarket": [
          "endTime",
          "singlePriceAuctionStartTime",
          "startTime"
        ],
        "result.today.integrated.regularMarket": [
          "endTime",
          "singlePriceAuctionStartTime",
          "startTime"
        ]
      },
      "/api/v1/market-calendar/US": {
        "result": [
          "nextBusinessDay",
          "previousBusinessDay",
          "today"
        ],
        "result.nextBusinessDay": [
          "afterMarket",
          "date",
          "dayMarket",
          "preMarket",
          "regularMarket"
        ],
        "result.nextBusinessDay.afterMarket": [
          "endTime",
          "startTime"
        ],
        "result.nextBusinessDay.dayMarket": [
          "endTime",
          "startTime"
        ],
        "result.nextBusinessDay.preMarket": [
          "endTime",
          "startTime"
        ],
        "result.nextBusinessDay.regularMarket": [
          "endTime",
          "startTime"
        ],
        "result.previousBusinessDay": [
          "afterMarket",
          "date",
          "dayMarket",
          "preMarket",
          "regularMarket"
        ],
        "result.previousBusinessDay.afterMarket": [
          "endTime",
          "startTime"
        ],
        "result.previousBusinessDay.dayMarket": [
          "endTime",
          "startTime"
        ],
        "result.previousBusinessDay.preMarket": [
          "endTime",
          "startTime"
        ],
        "result.previousBusinessDay.regularMarket": [
          "endTime",
          "startTime"
        ],
        "result.today": [
          "afterMarket",
          "date",
          "dayMarket",
          "preMarket",
          "regularMarket"
        ],
        "result.today.afterMarket": [
          "endTime",
          "startTime"
        ],
        "result.today.dayMarket": [
          "endTime",
          "startTime"
        ],
        "result.today.preMarket": [
          "endTime",
          "startTime"
        ],
        "result.today.regularMarket": [
          "endTime",
          "startTime"
        ]
      },
      "/api/v1/market-indicators/{symbol}/candles": {
        "result": [
          "candles",
          "nextBefore"
        ],
        "result.candles": [
          "closePrice",
          "highPrice",
          "lowPrice",
          "openPrice",
          "timestamp",
          "volume"
        ]
      },
      "/api/v1/orders": {
        "result": [
          "hasNext",
          "nextCursor",
          "orders"
        ],
        "result.orders": [
          "canceledAt",
          "currency",
          "execution",
          "orderAmount",
          "orderId",
          "orderType",
          "orderedAt",
          "price",
          "quantity",
          "side",
          "status",
          "symbol",
          "timeInForce"
        ],
        "result.orders.execution": [
          "averageFilledPrice",
          "commission",
          "filledAmount",
          "filledAt",
          "filledQuantity",
          "settlementDate",
          "tax"
        ]
      },
      "/api/v1/prices": {
        "result": [
          "currency",
          "lastPrice",
          "symbol",
          "timestamp"
        ]
      },
      "/api/v1/sectors": {
        "result": [
          "sectors"
        ],
        "result.sectors": [
          "depth",
          "name",
          "parentSectorId",
          "sectorId"
        ]
      },
      "/api/v1/sectors/{sectorId}/etfs": {
        "result": [
          "etfs"
        ],
        "result.etfs": [
          "name",
          "symbol"
        ]
      },
      "/api/v1/sectors/{sectorId}/stocks": {
        "result": [
          "stocks"
        ],
        "result.stocks": [
          "currency",
          "marketCapitalization",
          "name",
          "symbol",
          "tradingAmount",
          "volume"
        ]
      },
      "/api/v1/stocks": {
        "result": [
          "currency",
          "delistDate",
          "englishName",
          "isCommonShare",
          "isinCode",
          "koreanMarketDetail",
          "leverageFactor",
          "listDate",
          "market",
          "name",
          "securityType",
          "sharesOutstanding",
          "status",
          "symbol"
        ],
        "result.koreanMarketDetail": [
          "krxTradingSuspended",
          "liquidationTrading",
          "nxtSupported",
          "nxtTradingSuspended"
        ]
      },
      "/api/v1/transactions": {
        "result": [
          "hasNext",
          "nextCursor",
          "transactions"
        ],
        "result.transactions": [
          "amount",
          "assetClass",
          "commission",
          "currency",
          "exchangeRate",
          "filledPrice",
          "isCancellation",
          "isinCode",
          "marketCountry",
          "netAmount",
          "quantity",
          "settled",
          "settlementDate",
          "symbol",
          "tax",
          "transactionTime",
          "transactionType"
        ]
      }
    },
    "recordedAt": "2026-11-17"
  }
};
