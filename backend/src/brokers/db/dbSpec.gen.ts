// ⚠ 자동 생성 파일 — 직접 고치지 말 것. `npm run spec:types`가 backend/spec/snapshots/db.json에서 만든다.
// 증권사 공식 명세 중 MyStock이 쓰는 엔드포인트의 구조만 담았다(scripts/spec-watch.cjs).
/* eslint-disable */
// 기준: DB증권 포털 TR 필드 명세(openapi.dbsec.co.kr guide/tr/property)

export interface DbRequests {
  CAZCQ00200: {
    "In": {
      "QrySrtDt": string;
      "QryEndDt": string;
      "AstkIsuNo": string;
      "AstkBnsTpCode": string;
      "StnlnTpCode": string;
      "QryTpCode": string;
      "WonFcurrTpCode": string;
      "BaseDdTpCode": string;
      "DpntBalTpCode": string;
    };
  };
  CAZCQ00400: {
    "In": {
      "TrxTpCode": string;
      "CmsnTpCode": string;
      "WonFcurrTpCode": string;
      "DpntBalTpCode": string;
    };
  };
  CAZCQ01600: {
    "In": {
      "QrySrtDt": string;
      "QryEndDt": string;
      "StnlnTpCode": string;
      "AstkIsuNo": string;
      "QryTpCode": string;
      "DpntBalTpCode": string;
    };
  };
  CDPCQ00100: {
    "In": Record<string, never>;
  };
  CDPCQ04700: {
    "In": {
      "QryTp": string;
      "QrySrtDt": string;
      "QryEndDt": string;
      "SrtNo": number | string;
      "IsuNo": string;
    };
  };
  CSPAQ03420: {
    "In": {
      "QryTpCode0": string;
    };
  };
}

export interface DbResponses {
  /** POST /api/v1/trading/overseas-stock/inquiry/trading-history (초당 2건) */
  CAZCQ00200: {
    rsp_cd?: string;
    rsp_msg?: string;
    "Out"?: Array<{
      "OrdDt"?: string;
      "OrdNo"?: number | string;
      "AstkMktCode"?: string;
      "AstkMktNm"?: string;
      "AstkIsuNo"?: string;
      "AstkHanglIsuNm"?: string;
      "SymCode"?: string;
      "OwnSeCode"?: string;
      "AstkSeNm"?: string;
      "ShtnCntrySymCode"?: string;
      "AstkBnsTpCode"?: string;
      "BnsTpNm"?: string;
      "AstkExecQty"?: number | string;
      "AstkExecPrc"?: number | string;
      "AstkExecAmt"?: number | string;
      "AstkExecCmsn"?: number | string;
      "AstkExecLclCmsn"?: number | string;
      "AstkSettAmt"?: number | string;
      "CrcyCode"?: string;
      "SettDt"?: string;
      "MnySettDt"?: string;
      "SecSettDt"?: string;
      "RsvOrdDt"?: string;
      "RsvOrdNo"?: number | string;
      "AstkRsvOrdPtnCode"?: string;
      "OtptItemNm"?: string;
      "LoanDt"?: string;
      "DpntBalTpNm"?: string;
    }>;
    "Out1"?: {
      "AdjstAmt"?: number | string;
      "ExecAmt"?: number | string;
      "Cmsn"?: number | string;
      "TaxAmt"?: number | string;
    } | Array<{
      "AdjstAmt"?: number | string;
      "ExecAmt"?: number | string;
      "Cmsn"?: number | string;
      "TaxAmt"?: number | string;
    }>;
  };
  /** POST /api/v1/trading/overseas-stock/inquiry/balance-margin (초당 3건) */
  CAZCQ00400: {
    rsp_cd?: string;
    rsp_msg?: string;
    "Out"?: {
      "Dps"?: number | string;
      "OrdAbleAmt"?: number | string;
      "MnyoutAbleAmt"?: number | string;
      "BalEvalAmt"?: number | string;
      "EvalPnlAmt"?: number | string;
      "ErnRat"?: number | string;
      "PchsAmt"?: number | string;
      "Cmsn"?: number | string;
      "TaxAmt"?: number | string;
      "ThdayRlzPnlAmt"?: number | string;
      "AssetAmtTotamt"?: number | string;
      "UnsttAmt"?: number | string;
    } | Array<{
      "Dps"?: number | string;
      "OrdAbleAmt"?: number | string;
      "MnyoutAbleAmt"?: number | string;
      "BalEvalAmt"?: number | string;
      "EvalPnlAmt"?: number | string;
      "ErnRat"?: number | string;
      "PchsAmt"?: number | string;
      "Cmsn"?: number | string;
      "TaxAmt"?: number | string;
      "ThdayRlzPnlAmt"?: number | string;
      "AssetAmtTotamt"?: number | string;
      "UnsttAmt"?: number | string;
    }>;
    "Out1"?: Array<{
      "CrcyCode"?: string;
      "CrcyCodeNm"?: string;
      "FcurrDps"?: number | string;
      "AstkEstiDps"?: number | string;
      "AstkMgn"?: number | string;
      "AstkReBuyAbleAmt"?: number | string;
      "AstkOrdAbleAmt"?: number | string;
      "AstkMnyoutAbleAmt"?: number | string;
      "AstkUnsttSellAmt"?: number | string;
      "AstkUnsttBuyAmt"?: number | string;
      "AstkEvalAmt"?: number | string;
      "AstkAssetEvalAmt"?: number | string;
      "WonEvalAmt"?: number | string;
      "AvrXchrat"?: number | string;
      "Xchrat"?: number | string;
      "FcurrRcvblAmt"?: number | string;
      "AstkOrdAbleAmt0"?: number | string;
      "FcurrOthrCrcyMgn"?: number | string;
      "OthrCrcyMgnWtAmt"?: number | string;
    }>;
    "Out2"?: Array<{
      "AstkIsuNo"?: string;
      "AstkHanglIsuNm"?: string;
      "SymCode"?: string;
      "OwnSeCode"?: string;
      "AstkSeNm"?: string;
      "ShtnCntrySymCode"?: string;
      "CntryNm"?: string;
      "CrcyCode"?: string;
      "AstkMktCode"?: string;
      "AstkMktNm"?: string;
      "AstkExecBaseQty"?: number | string;
      "AstkSettBaseQty"?: number | string;
      "AstkRopSetupQty"?: number | string;
      "AstkOrdAbleQty"?: number | string;
      "AstkAvrPchsPrc"?: number | string;
      "WonAmt1"?: number | string;
      "AstkNowPrc"?: number | string;
      "WonAmt2"?: number | string;
      "AstkBuyAmt"?: number | string;
      "WonAmt3"?: number | string;
      "AstkEvalAmt"?: number | string;
      "WonAmt4"?: number | string;
      "AstkEvalPnlAmt"?: number | string;
      "WonAmt5"?: number | string;
      "EvalPnlRat"?: number | string;
      "EvalPnlRat0"?: number | string;
      "AstkCmsn"?: number | string;
      "WonAmt6"?: number | string;
      "AstkTaxAmt"?: number | string;
      "WonAmt7"?: number | string;
      "AstkPrdayCmpPrc"?: number | string;
      "WonAmt8"?: number | string;
      "AstkUpdnRat"?: number | string;
      "HldWeght"?: number | string;
      "TpVal"?: string;
      "DueDt"?: string;
      "LoanDt"?: string;
      "LoanAmt"?: number | string;
      "AstkBuyCmsn"?: number | string;
      "WonAmt9"?: number | string;
      "AstkSellCmsn"?: number | string;
      "WonAmt0"?: number | string;
      "AstkCmsnRat"?: number | string;
      "AstkCmsnRat0"?: number | string;
      "ThdayRlzPnlAmt"?: number | string;
      "AstkSellExecQty"?: number | string;
      "AstkSellExecAmt"?: number | string;
      "AstkExecBaseBuyCost"?: number | string;
      "AstkCmsnRat1"?: number | string;
    }>;
    "Out3"?: Array<{
      "ShtnCntrySymCode"?: string;
      "CntryNm"?: string;
      "CrcyCode"?: string;
      "AstkBuyAmt"?: number | string;
      "WonAmt1"?: number | string;
      "AstkEvalAmt"?: number | string;
      "WonAmt2"?: number | string;
      "AstkEvalPnlAmt"?: number | string;
      "WonAmt3"?: number | string;
      "EvalPnlRat"?: number | string;
      "EvalPnlRat0"?: number | string;
      "AstkCmsn"?: number | string;
      "WonAmt4"?: number | string;
      "AstkTaxAmt"?: number | string;
      "WonAmt5"?: number | string;
      "AstkBuyCmsn"?: number | string;
      "WonAmt6"?: number | string;
      "AstkSellCmsn"?: number | string;
      "WonAmt7"?: number | string;
    }>;
  };
  /** POST /api/v1/trading/overseas-stock/inquiry/trade-history (초당 2건) */
  CAZCQ01600: {
    rsp_cd?: string;
    rsp_msg?: string;
    "Out"?: Array<{
      "TrdDt"?: string;
      "TrdTime"?: string;
      "SmryNm"?: string;
      "AstkIsuNo"?: string;
      "AstkEngIsuNm"?: string;
      "AstkHanglIsuNm"?: string;
      "AstkMktCode"?: string;
      "SymCode"?: string;
      "OwnSeCode"?: string;
      "AstkSeNm"?: string;
      "CrcyCode"?: string;
      "AstkTrdQty"?: number | string;
      "AstkBnsAmt"?: number | string;
      "AstkTrdUprc"?: number | string;
      "AstkCmsn"?: number | string;
      "AstkTaxAmt"?: number | string;
      "AstkCrbalQty"?: number | string;
      "AstkAppXchrat"?: number | string;
      "FcurrTrdAmt"?: number | string;
      "FcurrDpsCrbalAmt"?: number | string;
      "TrdAmt"?: number | string;
      "DpsCrbalAmt"?: number | string;
      "FcurrRcvblRepayAmt"?: number | string;
      "FcurrRcvblOcrAmt"?: number | string;
      "FcurrRcvblAmt"?: number | string;
      "FcurrOdpnt"?: number | string;
      "OppAcntNo"?: string;
      "OppAcntNm"?: string;
      "OthbkpOppCoNo"?: string;
      "BkeepIttNm"?: string;
    }>;
  };
  /** POST /api/v1/trading/kr-stock/inquiry/acnt-deposit (초당 1건) */
  CDPCQ00100: {
    rsp_cd?: string;
    rsp_msg?: string;
    "Out"?: unknown;
    "Out1"?: {
      "DpsBalAmt"?: number | string;
      "MgnMny"?: number | string;
      "PldgCurAmt"?: number | string;
      "AddCrdtPldgMny"?: number | string;
      "RcvblEnsrAmt"?: number | string;
      "SubstAmt"?: number | string;
      "SubstMgn"?: number | string;
      "PldgSubstAmt0"?: number | string;
      "AddCrdtPldgSubst"?: number | string;
      "RgtsbAmt"?: number | string;
      "ChckAmt"?: number | string;
      "UnSettEtcChckAmt"?: number | string;
      "CrdtPldgRuseAmt"?: number | string;
      "Imreq"?: number | string;
      "DpslRestrcAmt"?: number | string;
      "WthdwAbleAmt"?: number | string;
      "SfaccMloanAmt"?: number | string;
      "MktcplMloanAmt"?: number | string;
      "MloanTotamt"?: number | string;
      "SfaccSloanAmt"?: number | string;
      "MktcplSloanAmt"?: number | string;
      "SloanTotamt"?: number | string;
      "MnyrclAmt"?: number | string;
      "IntrstDlinqAmt"?: number | string;
      "Etclnd"?: number | string;
      "OldUnRfundAmt"?: number | string;
      "DpspdgLoanEvalAmt"?: number | string;
      "DpspdgLoanAbleLmt"?: number | string;
      "DpspdgLoanBal"?: number | string;
      "DpspdgLoanAbleAmt"?: number | string;
      "DpspdgLoanIntdltAmt"?: number | string;
      "PmLoanEvalAmt"?: number | string;
      "PmLoanAbleLmt"?: number | string;
      "PmLoanBal"?: number | string;
      "PmLoanAbleAmt"?: number | string;
      "PmLoanIntdltAmt"?: number | string;
      "BuyAdjstAmtD1"?: number | string;
      "SellAdjstAmtD1"?: number | string;
      "RepayRqrdAmtD1"?: number | string;
      "PrsmptDpsD1"?: number | string;
      "PrsmptMnyoutAbleAmtD1"?: number | string;
      "BuyAdjstAmtD2"?: number | string;
      "SellAdjstAmtD2"?: number | string;
      "RepayRqrdAmtD2"?: number | string;
      "PrsmptDpsD2"?: number | string;
      "PrsmptMnyoutAbleAmtD2"?: number | string;
      "MnyRuseUseAmt"?: number | string;
      "MnyRuseUseAmt1"?: number | string;
      "SubstRuseUseAmt"?: number | string;
      "SubstRuseUseAmt1"?: number | string;
    } | Array<{
      "DpsBalAmt"?: number | string;
      "MgnMny"?: number | string;
      "PldgCurAmt"?: number | string;
      "AddCrdtPldgMny"?: number | string;
      "RcvblEnsrAmt"?: number | string;
      "SubstAmt"?: number | string;
      "SubstMgn"?: number | string;
      "PldgSubstAmt0"?: number | string;
      "AddCrdtPldgSubst"?: number | string;
      "RgtsbAmt"?: number | string;
      "ChckAmt"?: number | string;
      "UnSettEtcChckAmt"?: number | string;
      "CrdtPldgRuseAmt"?: number | string;
      "Imreq"?: number | string;
      "DpslRestrcAmt"?: number | string;
      "WthdwAbleAmt"?: number | string;
      "SfaccMloanAmt"?: number | string;
      "MktcplMloanAmt"?: number | string;
      "MloanTotamt"?: number | string;
      "SfaccSloanAmt"?: number | string;
      "MktcplSloanAmt"?: number | string;
      "SloanTotamt"?: number | string;
      "MnyrclAmt"?: number | string;
      "IntrstDlinqAmt"?: number | string;
      "Etclnd"?: number | string;
      "OldUnRfundAmt"?: number | string;
      "DpspdgLoanEvalAmt"?: number | string;
      "DpspdgLoanAbleLmt"?: number | string;
      "DpspdgLoanBal"?: number | string;
      "DpspdgLoanAbleAmt"?: number | string;
      "DpspdgLoanIntdltAmt"?: number | string;
      "PmLoanEvalAmt"?: number | string;
      "PmLoanAbleLmt"?: number | string;
      "PmLoanBal"?: number | string;
      "PmLoanAbleAmt"?: number | string;
      "PmLoanIntdltAmt"?: number | string;
      "BuyAdjstAmtD1"?: number | string;
      "SellAdjstAmtD1"?: number | string;
      "RepayRqrdAmtD1"?: number | string;
      "PrsmptDpsD1"?: number | string;
      "PrsmptMnyoutAbleAmtD1"?: number | string;
      "BuyAdjstAmtD2"?: number | string;
      "SellAdjstAmtD2"?: number | string;
      "RepayRqrdAmtD2"?: number | string;
      "PrsmptDpsD2"?: number | string;
      "PrsmptMnyoutAbleAmtD2"?: number | string;
      "MnyRuseUseAmt"?: number | string;
      "MnyRuseUseAmt1"?: number | string;
      "SubstRuseUseAmt"?: number | string;
      "SubstRuseUseAmt1"?: number | string;
    }>;
    "Out2"?: unknown;
    "Out3"?: unknown;
    "Out4"?: unknown;
  };
  /** POST /api/v1/trading/kr-stock/inquiry/trading-history (초당 2건) */
  CDPCQ04700: {
    rsp_cd?: string;
    rsp_msg?: string;
    "Out"?: {
      "AcntNm"?: string;
    } | Array<{
      "AcntNm"?: string;
    }>;
    "Out1"?: Array<{
      "AcntNo"?: string;
      "TrdDt"?: string;
      "TrdNo"?: number | string;
      "TpCodeNm"?: string;
      "SmryNo"?: string;
      "SmryNm"?: string;
      "CancTpNm"?: string;
      "TrdQty"?: number | string;
      "Trtax"?: number | string;
      "AdjstAmt"?: number | string;
      "OvdSum"?: number | string;
      "DpsBfbalAmt"?: number | string;
      "SellPldgRfundAmt"?: number | string;
      "DpspdgLoanBfbalAmt"?: number | string;
      "OrgTrdNo"?: number | string;
      "IsuNm"?: string;
      "TrdUprc"?: number | string;
      "CmsnAmt"?: number | string;
      "RfundDiffAmt"?: number | string;
      "RepayAmtSum"?: number | string;
      "SecCrbalQty"?: number | string;
      "CslLoanRfundIntrstAmt"?: number | string;
      "DpspdgLoanCrbalAmt"?: number | string;
      "TrxTime"?: string;
      "Inouno"?: number | string;
      "IsuNo"?: string;
      "TrdAmt"?: number | string;
      "TaxSumAmt"?: number | string;
      "IntrstUtlfee"?: number | string;
      "MnyDvdAmt"?: number | string;
      "RcvblOcrAmt"?: number | string;
      "DpspdgLoanAmt"?: number | string;
      "DpspdgLoanRfundAmt"?: number | string;
      "BasePrc"?: number | string;
      "DpsCrbalAmt"?: number | string;
      "BoaAmt"?: number | string;
      "MnyoutAbleAmt"?: number | string;
      "BcrLoanOcrAmt"?: number | string;
      "BcrLoanBfbalAmt"?: number | string;
      "BnsBasePrc"?: number | string;
      "TaxchrBasePrc"?: number | string;
      "TrdUnit"?: number | string;
      "BalUnit"?: number | string;
      "EvrTax"?: number | string;
      "EvalAmt"?: number | string;
      "BcrLoanRfundAmt"?: number | string;
      "BcrLoanCrbalAmt"?: number | string;
      "AddMgnOcrTotamt"?: number | string;
      "AddMnyMgnOcrAmt"?: number | string;
      "AddMgnDfryTotamt"?: number | string;
      "AddMnyMgnDfryAmt"?: number | string;
      "BnsplAmt"?: number | string;
      "Ictax"?: number | string;
      "Ihtax"?: number | string;
      "LoanDt"?: string;
      "CrcyCode"?: string;
      "FcurrAmt"?: number | string;
      "FcurrTrdAmt"?: number | string;
      "FcurrDps"?: number | string;
      "OppAcntNm"?: string;
      "OppAcntNo"?: string;
      "LoanRfundAmt"?: number | string;
      "LoanIntrstAmt"?: number | string;
      "AskpsnNm"?: string;
      "BkeepIttNm"?: string;
    }>;
    "Out2"?: {
      "PnlSumAmt"?: number | string;
      "CtrctAsm"?: number | string;
      "CmsnAmtSumAmt"?: number | string;
    } | Array<{
      "PnlSumAmt"?: number | string;
      "CtrctAsm"?: number | string;
      "CmsnAmtSumAmt"?: number | string;
    }>;
    "Out3"?: {
      "MnyinAmt"?: number | string;
      "SecinAmt"?: number | string;
      "MnyoutAmt"?: number | string;
      "SecoutAmt"?: number | string;
      "DiffAmt"?: number | string;
      "DiffAmt0"?: number | string;
    } | Array<{
      "MnyinAmt"?: number | string;
      "SecinAmt"?: number | string;
      "MnyoutAmt"?: number | string;
      "SecoutAmt"?: number | string;
      "DiffAmt"?: number | string;
      "DiffAmt0"?: number | string;
    }>;
  };
  /** POST /api/v1/trading/kr-stock/inquiry/balance (초당 2건) */
  CSPAQ03420: {
    rsp_cd?: string;
    rsp_msg?: string;
    "Out"?: {
      "TotBuyAmt"?: number | string;
      "TotEvalAmt"?: number | string;
      "TotEvalPnlAmt"?: number | string;
      "TotErnrat"?: number | string;
      "ThdaySellAmt"?: number | string;
      "ThdayBuyAmt"?: number | string;
      "ThdayRlzPnlAmt"?: number | string;
      "CrdtBnsAmt"?: number | string;
      "DpsastAmt"?: number | string;
      "Dps2"?: number | string;
    } | Array<{
      "TotBuyAmt"?: number | string;
      "TotEvalAmt"?: number | string;
      "TotEvalPnlAmt"?: number | string;
      "TotErnrat"?: number | string;
      "ThdaySellAmt"?: number | string;
      "ThdayBuyAmt"?: number | string;
      "ThdayRlzPnlAmt"?: number | string;
      "CrdtBnsAmt"?: number | string;
      "DpsastAmt"?: number | string;
      "Dps2"?: number | string;
    }>;
    "Out1"?: Array<{
      "IsuNo"?: string;
      "IsuNm"?: string;
      "BalQty"?: number | string;
      "BalQty0"?: number | string;
      "AbleQty"?: number | string;
      "ExecPrc"?: number | string;
      "EvalAmt"?: number | string;
      "EvalPnlAmt"?: number | string;
      "Ernrat"?: number | string;
      "MnyAmt"?: number | string;
      "CrdtAmt"?: number | string;
      "PchsAmt"?: number | string;
      "LoanDt"?: string;
      "DueDt"?: string;
      "EvrTax"?: number | string;
      "BnsCmsn"?: number | string;
      "SellCmsn"?: number | string;
      "ThdayBuyQty"?: number | string;
      "ThdaySellQty"?: number | string;
      "BuyRat"?: number | string;
      "EvalRat"?: number | string;
      "NowPrc"?: number | string;
      "ThdaySellAmt"?: number | string;
      "ThdayBuyAmt"?: number | string;
      "ThdayRlzPnlAmt"?: number | string;
    }>;
  };
}
