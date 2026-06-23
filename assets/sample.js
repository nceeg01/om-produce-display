/* ============================================================
   OM Produce — Sample data (DEMO mode only)
   Used when no Web-App URL is configured, so the screens render
   for UI review. Real deployments never hit this.
   ============================================================ */
window.OM_SAMPLE = function () {
  var now = Date.now();
  var min = 60000;
  // helper: minutes-ago timestamp
  function ago(m) { return now - m * min; }

  var orders = [
    { id: '0623-009', customer: 'Arora Market',     status: 'Ready',     boxes: 12, addon1: 'Mint', addon2: 'Cilantro', waitMin: 0,  created: ago(58), waitSetAt: ago(20),
      t_received: ago(58), t_pulling: ago(40), t_ready: ago(8) },
    { id: '0623-010', customer: 'Green Valley Foods', status: 'Invoiced', boxes: 7,  waitMin: 0,  created: ago(52), waitSetAt: ago(18),
      t_received: ago(52), t_pulling: ago(38), t_ready: ago(12), t_invoiced: ago(3) },
    { id: '0623-011', customer: 'Sunrise Grocers',   status: 'Pulling',   boxes: 20, addon1: 'Ice pack', waitMin: 15, created: ago(36), waitSetAt: ago(6),
      t_received: ago(36), t_pulling: ago(6) },
    { id: '0623-012', customer: 'Patel Brothers',    status: 'Pulling',   boxes: 9,  waitMin: 25, created: ago(31), waitSetAt: ago(28),
      t_received: ago(31), t_pulling: ago(28) }, // long pull → stale demo
    { id: '0623-013', customer: 'Fresh Mart',        status: 'Received',  boxes: 0,  waitMin: 0,  created: ago(14),
      t_received: ago(14) },
    { id: '0623-014', customer: 'City Produce Co',   status: 'Received',  boxes: 0,  addon1: 'Call on arrival', waitMin: 0, created: ago(6),
      t_received: ago(6) },
    { id: '0623-007', customer: 'Lotus Foods',       status: 'Done',      boxes: 15, waitMin: 0,  created: ago(95), waitSetAt: ago(60),
      t_received: ago(95), t_pulling: ago(80), t_ready: ago(60), t_invoiced: ago(52), t_done: ago(44) },
    { id: '0623-008', customer: 'Mediterra Imports', status: 'Done',      boxes: 6,  waitMin: 0,  created: ago(88), waitSetAt: ago(55),
      t_received: ago(88), t_pulling: ago(70), t_ready: ago(50), t_invoiced: ago(46), t_done: ago(38) },
  ];

  return { orders: orders, serverNow: now };
};
