import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import collect_oi
from collect_funding import DataError

NOW = '2026-10-25T05:00:00.000Z'
def payload(symbol='BTC', **fields):
    row = dict(instId=symbol+'-USDT-SWAP',instType='SWAP',oi='100',oiCcy='1',oiUsd='80000',ts='1792904400000')
    row.update(fields)
    return {'code':'0','data':[row]}

class OITests(unittest.TestCase):
    def test_units_and_zero_are_preserved(self):
        r=collect_oi.normalize(payload(), 'BTC', NOW)
        self.assertEqual((r['contracts'],r['coin'],r['usd']),(100,1,80000))
        self.assertEqual(collect_oi.normalize(payload(oi='0',oiCcy='0',oiUsd='0'),'BTC',NOW)['usd'],0)

    def test_invalid_fields_contract_and_times_are_rejected(self):
        for kwargs in ({'oi':'NaN'},{'oiUsd':'-1'},{'oiCcy':''},{'instId':'ETH-USDT-SWAP'},{'ts':'1'},{'ts':'1792914400000'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(DataError):
                collect_oi.normalize(payload(**kwargs),'BTC',NOW)

    def test_failure_retains_observations_and_duplicate_does_not_inflate_history(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(collect_oi,'utc_now',return_value=NOW), patch.object(collect_oi,'get_json',side_effect=lambda url,params:payload(params['instId'].split('-')[0])):
                collect_oi.collect(directory)
                result=collect_oi.collect(directory)
                self.assertEqual(len(result['records']),2)
            with patch.object(collect_oi,'get_json',side_effect=DataError('http_403','blocked')) as request:
                result=collect_oi.collect(directory)
                self.assertEqual(request.call_count,1)
                self.assertEqual(len(result['records']),2)
                self.assertTrue(all(s['status']=='failed' for s in result['states'].values()))
                self.assertTrue((Path(directory)/'oi-data.js').read_text().startswith('window.OI_DATA = '))

    def test_old_observations_are_pruned_and_other_symbol_survives_partial_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'data/oi/series.json';path.parent.mkdir(parents=True)
            old=collect_oi.normalize(payload(),'BTC',NOW);old['time']='2025-01-01T00:00:00Z'
            path.write_text(json.dumps({'records':[old]}))
            with patch.object(collect_oi,'utc_now',return_value=NOW), patch.object(collect_oi,'get_json',side_effect=[payload(),DataError('timeout','timeout')]):
                result=collect_oi.collect(directory)
            self.assertEqual(len(result['records']),1)
            self.assertEqual(result['states']['ETH']['status'],'failed')
