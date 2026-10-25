import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timezone
import collect_basis
from collect_funding import DataError,utc_now

def fixtures(symbol='BTC',delta=0,price=101,index=100):
    t=datetime.now(timezone.utc).timestamp();stamp=int((t+delta)*1000)
    mark={'symbol':symbol,'contract':symbol+'-USDT-SWAP','venue':'okx','price':price,'time':datetime.fromtimestamp(t,timezone.utc).isoformat()}
    payload={'code':'0','data':[{'instId':symbol+'-USDT','idxPx':str(index),'ts':str(stamp)}]}
    return payload,mark
class BasisTests(unittest.TestCase):
    def test_zero_negative_and_positive_premium(self):
        for price,premium in [(100,0),(101,1),(99,-1)]:
            p,m=fixtures(price=price)
            r=collect_basis.normalize(p,m,'BTC',utc_now())
            self.assertAlmostEqual(r['premium_pct'],premium)
            self.assertEqual(r['spread'],price-100)
    def test_mismatch_stale_skew_and_nonfinite_are_rejected(self):
        for kind in ['index','mark','zero','nan','stale','skew']:
            p,m=fixtures(delta=-150 if kind=='skew' else -400 if kind=='stale' else 0)
            if kind=='index':p['data'][0]['instId']='BTC-USD'
            if kind=='mark':m['contract']='ETH-USDT-SWAP'
            if kind=='zero':p['data'][0]['idxPx']='0'
            if kind=='nan':m['price']=float('nan')
            with self.subTest(kind=kind),self.assertRaises(DataError):
                collect_basis.normalize(p,m,'BTC',utc_now())
    def test_success_deduplicates_and_failed_mark_does_not_reuse_old_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'data/price/series.json';path.parent.mkdir(parents=True)
            now=utc_now();pairs={s:fixtures(s) for s in ('BTC','ETH')}
            marks=[]
            for s in pairs:
                m=pairs[s][1];m['fetched_at']=now;marks.append(m)
            price={'attempted_at':now,'states':{s:{'status':'ok'} for s in pairs},'records':marks};path.write_text(json.dumps(price))
            with patch.object(collect_basis,'get_json',side_effect=lambda u,p:pairs[p['instId'].split('-')[0]][0]):
                self.assertEqual(len(collect_basis.collect(root)['records']),2)
                self.assertEqual(len(collect_basis.collect(root)['records']),2)
            price['states']={s:{'status':'failed'} for s in pairs};path.write_text(json.dumps(price))
            with patch.object(collect_basis,'get_json') as request:
                result=collect_basis.collect(root)
                request.assert_not_called()
                self.assertEqual(len(result['records']),2)
                self.assertEqual(result['states']['BTC']['code'],'mark_unavailable')
