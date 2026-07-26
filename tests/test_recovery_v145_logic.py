import unittest

def displayed_run(current, historical, open_debts):
    return max(0, max(current, historical) - open_debts)

class RecoveryCounterTests(unittest.TestCase):
    def test_one_pending_subtracts_one(self):
        self.assertEqual(displayed_run(32, 32, 1), 31)
    def test_scheduled_is_still_debt(self):
        self.assertEqual(displayed_run(32, 32, 2), 30)
    def test_recovered_restores_point(self):
        self.assertEqual(displayed_run(32, 32, 0), 32)
    def test_never_negative(self):
        self.assertEqual(displayed_run(0, 2, 5), 0)

if __name__ == '__main__':
    unittest.main()
