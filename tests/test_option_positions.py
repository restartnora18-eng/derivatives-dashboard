import unittest,tempfile
from unittest.mock import patch
from datetime import datetime,timezone,timedelta
import collect_option_positions as m
from collect_funding import utc_now,DataError

def fixture(symbol='BTC'):
 now=datetime.now(timezone.utc);expiry=str(int((now+timedelta(days=7)).timestamp()*1000));ts=str(int(now.timestamp()*1000));ins=[];ois=[]
 for opt,oi in [('C',100),('P',50)]:
  name=symbol+'-USD-TEST-'+opt
  ins.append(dict(instId=name,instFamily=symbol+'-USD',instType='OPTION',state='live',expTime=expiry,settleCcy=symbol,ctValCcy=symbol,ctType='inverse',optType=opt,ctVal='1',ctMult='.01',stk='100'))
  ois.append(dict(instId=name,instType='OPTION',oi=str(oi),oiCcy=str(oi*.01),ts=ts))
 return {'code':'0','data':ins},{'code':'0','data':ois}

class PositionTests(unittest.TestCase):
 def test_multiplier_and_aggregate_ratio(self):
  i,o=fixture();r=m.aggregate(i,o,'BTC',utc_now());self.assertEqual(r['call_coin'],1);self.assertEqual(r['put_coin'],.5);self.assertEqual(r['pcr'],.5);self.assertEqual(r['matched_contracts'],2)
 def test_zero_call_is_undefined_not_infinite(self):
  i,o=fixture();o['data'][0].update(oi='0',oiCcy='0');self.assertIsNone(m.aggregate(i,o,'BTC',utc_now())['pcr'])
 def test_missing_duplicate_stale_and_wrong_units_fail(self):
  for case in ['missing','duplicate','stale','unit','nan']:
   i,o=fixture()
   if case=='missing':o['data'].pop()
   if case=='duplicate':o['data'].append(o['data'][0])
   if case=='stale':o['data'][0]['ts']='1'
   if case=='unit':o['data'][0]['oiCcy']='99'
   if case=='nan':o['data'][0]['oi']='NaN'
   with self.subTest(case=case),self.assertRaises((DataError,ValueError)):m.aggregate(i,o,'BTC',utc_now())
 def test_expired_extra_oi_is_excluded_without_changing_ratio(self):
  i,o=fixture();o['data'].append(dict(instId='BTC-USD-EXPIRED',instType='OPTION',oi='99999'));r=m.aggregate(i,o,'BTC',utc_now());self.assertEqual(r['ignored_rows'],1);self.assertEqual(r['pcr'],.5)
 def test_failure_preserves_complete_snapshot_and_history(self):
  def request(url,p):return fixture(p['instFamily'].split('-')[0])[0 if url.endswith('instruments') else 1]
  with tempfile.TemporaryDirectory() as d:
   with patch.object(m,'get_json',side_effect=request):first=m.collect(d)
   with patch.object(m,'get_json',side_effect=DataError('http_403','blocked')) as req:second=m.collect(d)
   self.assertEqual(req.call_count,1);self.assertEqual(first['snapshots'],second['snapshots']);self.assertEqual(first['records'],second['records'])
