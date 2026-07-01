// ============================================================
// zapfood_supabase.js  — paste this ONCE in each HTML file
// Replace YOUR_URL and YOUR_ANON_KEY with your Supabase project values
// ============================================================

// ─── CONFIG ─────────────────────────────────────────────────
const SUPABASE_URL  = 'https://adrswghozchfbazwfnzr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkcnN3Z2hvemNoZmJhendmbnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTc5MzcsImV4cCI6MjA5ODQ5MzkzN30.VAKnkX_bmESeQsKtpphVc7zpxdiLNZslofcmc3mWMMc';

// Add this CDN in <head> of every HTML file:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);


// ============================================================
// A.  CUSTOMER APP  (food_ordering_app.html)
// ============================================================

// ── A1. Auth: Sign Up ────────────────────────────────────────
async function handleSignUp(email, password, fullName, phone) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: fullName } }
  });
  if (error) return showToast('❌ ' + error.message);

  // Save extra fields to profile
  await sb.from('profiles').update({ phone, full_name: fullName })
    .eq('id', data.user.id);

  showToast('Account created! Welcome to ZapFood 🎉');
  showView('menu');
}

// ── A2. Auth: Sign In ────────────────────────────────────────
async function handleSignIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return showToast('❌ ' + error.message);
  showToast('Signed in successfully! 🎉');
  showView('menu');
}

// ── A3. Auth: Sign Out ───────────────────────────────────────
async function handleSignOut() {
  await sb.auth.signOut();
  showToast('Signed out');
  showView('auth');
}

// ── A4. Auth: Listen for session changes ────────────────────
sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    // User is logged in — update nav button
    document.getElementById('auth-nav-btn').textContent = '👤 Profile';
  } else {
    document.getElementById('auth-nav-btn').textContent = '🔑 Sign in';
  }
});

// ── A5. Load Menu from Supabase ─────────────────────────────
async function loadMenuFromSupabase() {
  const { data, error } = await sb.from('menu_items')
    .select('*')
    .eq('is_active', true)
    .order('id');

  if (error) { console.error(error); return; }

  // Map Supabase rows → your existing MENU array format
  const mapped = data.map(m => ({
    id:       m.id,
    name:     m.name,
    desc:     m.description,
    price:    m.price,
    emoji:    m.emoji,
    cat:      m.category,
    veg:      m.is_veg
  }));

  window.MENU = mapped;   // replace the hardcoded MENU constant
  renderMenu(mapped);
}

// ── A6. Place Order ─────────────────────────────────────────
const MIN_ORDER = 99; // ₹ minimum order value

async function placeOrderSupabase(address, paymentMethod) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return showToast('Please sign in first');

  // Build items array from cart
  const keys = Object.keys(cart).filter(k => cart[k] > 0);
  const items = keys.map(k => {
    const item = MENU.find(m => m.id == k);
    return { id: item.id, name: item.name, qty: cart[k], price: item.price };
  });

  const sub  = keys.reduce((s,k) => { const i=MENU.find(m=>m.id==k); return s+i.price*cart[k]; }, 0);

  // ── MINIMUM ORDER CHECK ──
  if (sub < MIN_ORDER) {
    showToast(`Minimum order is ₹${MIN_ORDER}. Add ₹${MIN_ORDER - sub} more!`);
    return;
  }

  const tax  = Math.round(sub * 0.05);
  const otp  = String(Math.floor(1000 + Math.random() * 9000));

  const { data, error } = await sb.from('orders').insert({
    user_id:          user.id,
    delivery_address: address,
    items:            items,
    subtotal:         sub,
    tax:              tax,
    total:            sub + tax,
    payment_method:   paymentMethod,
    delivery_otp:     otp,
    status:           'pending'
  }).select().single();

  if (error) return showToast('❌ Order failed: ' + error.message);

  showToast(`Order placed! Your OTP is ${otp} 🎉`);
  cart = {};
  updateCartUI();
  loadUserOrders();
  setTimeout(() => showView('orders'), 1200);
}

// ── A6b. Forgot / Reset Password ────────────────────────────
async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password.html'
  });
  if (error) return showToast('❌ ' + error.message);
  showToast('Reset link sent! Check your email 📧');
}

// ── A7. Load User Orders ─────────────────────────────────────
async function loadUserOrders() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;

  const { data, error } = await sb.from('orders')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return console.error(error);

  // Map to existing renderOrders() format
  const mapped = data.map(o => ({
    id:     o.id,
    date:   new Date(o.created_at).toLocaleDateString('en-IN'),
    status: o.status,
    items:  o.items.map(i => `${i.name} ×${i.qty}`),
    total:  o.total,
    otp:    o.delivery_otp
  }));

  window.SAMPLE_ORDERS = mapped;
  renderOrders();
}

// ── A8. Realtime: Watch order status live ───────────────────
function subscribeToMyOrders(userId) {
  sb.channel('my-orders')
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'orders',
      filter: `user_id=eq.${userId}`
    }, payload => {
      const updated = payload.new;
      showToast(`Order ${updated.id} is now: ${updated.status} 🚀`);
      loadUserOrders();
    })
    .subscribe();
}


// ============================================================
// B.  ADMIN DASHBOARD  (admin_dashboard.html)
// ============================================================
// NOTE: Admin operations use service role key (keep server-side!)
// For this demo, use anon key + Supabase RLS disabled on admin panel
// OR use Supabase Edge Functions for sensitive writes.

// ── B1. Load All Orders ──────────────────────────────────────
async function adminLoadOrders() {
  const { data, error } = await sb.from('orders')
    .select('*, riders(name)')
    .order('created_at', { ascending: false });

  if (error) return console.error(error);

  window.ORDERS = data.map(o => ({
    id:       o.id,
    customer: o.customer_name,
    time:     new Date(o.created_at).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}),
    amount:   o.total,
    status:   o.status,
    rider:    o.rider_name || null,
    rider_id: o.rider_id   || null
  }));

  renderAllOrders();
  renderRecentOrders();
  updateOverviewStats();
}

// ── B2. Assign Rider ─────────────────────────────────────────
async function adminAssignRider(orderId, riderId, riderName) {
  const otp = String(Math.floor(1000 + Math.random() * 9000));

  const { error } = await sb.from('orders').update({
    rider_id:     riderId,
    rider_name:   riderName,
    status:       'otw',
    delivery_otp: otp
  }).eq('id', orderId);

  if (error) return toast('❌ ' + error.message);

  // Also update rider status to busy
  await sb.from('riders').update({ status: 'busy' }).eq('id', riderId);

  toast(`Rider assigned! OTP ${otp} sent to customer.`);
  adminLoadOrders();
  adminLoadRiders();
}

// ── B3. Load Riders ──────────────────────────────────────────
async function adminLoadRiders() {
  const { data, error } = await sb.from('riders').select('*').order('name');
  if (error) return console.error(error);

  window.RIDERS = data.map(r => ({
    id:         r.id,
    name:       r.name,
    phone:      r.phone,
    status:     r.status,
    rating:     r.rating,
    deliveries: r.total_deliveries,
    orders:     r.status === 'busy' ? 1 : 0
  }));

  renderRiders();
}

// ── B4. Send Notification (save to DB) ───────────────────────
async function adminSendNotification(type, title, message, target) {
  const { error } = await sb.from('notifications').insert({
    type, title, message, target
  });
  if (error) return toast('❌ ' + error.message);
  toast('Notification saved & sent!');
  adminLoadNotifications();
}

// ── B5. Load Notifications ───────────────────────────────────
async function adminLoadNotifications() {
  const { data } = await sb.from('notifications')
    .select('*').order('created_at', { ascending: false }).limit(20);

  window.notifLog = data.map(n => ({
    type:  n.type,
    title: n.title,
    msg:   n.message,
    time:  new Date(n.created_at).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}),
    target:n.target
  }));
  renderNotifLog();
}

// ── B6. Toggle Menu Item ─────────────────────────────────────
async function adminToggleMenuItem(id, currentActive) {
  const { error } = await sb.from('menu_items')
    .update({ is_active: !currentActive }).eq('id', id);
  if (error) return toast('❌ ' + error.message);
  adminLoadMenuItems();
}

// ── B7. Load Menu Items (admin) ──────────────────────────────
async function adminLoadMenuItems() {
  const { data } = await sb.from('menu_items').select('*').order('id');
  window.MENU_ITEMS = data.map(m => ({
    id:     m.id,
    name:   m.name,
    cat:    m.category,
    price:  m.price,
    active: m.is_active
  }));
  renderMenuMgmt();
}

// ── B8. Realtime: Watch new orders ───────────────────────────
function adminSubscribeRealtime() {
  sb.channel('admin-orders')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'orders'
    }, () => {
      adminLoadOrders();
    })
    .subscribe();

  sb.channel('admin-riders')
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'riders'
    }, () => {
      adminLoadRiders();
    })
    .subscribe();
}


// ============================================================
// C.  RIDER DASHBOARD  (rider_dashboard.html)
// ============================================================

// ── C1. Rider Login (simple phone-based, or use Supabase Auth) ──
// For demo: rider logs in with email/password (create rider auth accounts)
async function riderSignIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert('Login failed: ' + error.message);
  riderLoadData();
}

// ── C2. Load Rider's Active Order ────────────────────────────
async function riderLoadData() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;

  // Find rider by matching email (stored in riders table)
  const { data: rider } = await sb.from('riders')
    .select('*').eq('phone', user.email).single(); // or match by user metadata

  if (!rider) return;

  // Load active order assigned to this rider
  const { data: active } = await sb.from('orders')
    .select('*')
    .eq('rider_id', rider.id)
    .in('status', ['otw', 'assigned'])
    .single();

  if (active) {
    window.order = {
      id:       active.id,
      customer: active.customer_name,
      phone:    active.customer_phone,
      items:    active.items.map(i => `${i.name} ×${i.qty}`).join(', '),
      amount:   active.total,
      address:  active.delivery_address,
      otp:      active.delivery_otp,
      stage:    active.status === 'otw' ? 'otw' : 'assigned'
    };
  } else {
    window.order = null;
  }

  renderActive();

  // Load delivery history
  const { data: hist } = await sb.from('orders')
    .select('id, customer_name, total')
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')
    .order('updated_at', { ascending: false })
    .limit(10);

  window.history = (hist || []).map(h => ({
    id:       h.id,
    customer: h.customer_name,
    amount:   h.total,
    status:   'delivered'
  }));
  renderHistory();
}

// ── C3. Verify OTP & Complete Delivery ───────────────────────
async function riderVerifyOtp(orderId, enteredOtp) {
  // Fetch stored OTP
  const { data: ord } = await sb.from('orders')
    .select('delivery_otp').eq('id', orderId).single();

  if (!ord || ord.delivery_otp !== enteredOtp) {
    toast('Incorrect OTP — ask the customer again');
    return;
  }

  // Mark delivered
  await sb.from('orders').update({
    status:       'delivered',
    otp_verified: true
  }).eq('id', orderId);

  toast('Delivery confirmed! ✅');
  closeOtp();
  riderLoadData();
}

// ── C4. Update Rider Status ───────────────────────────────────
async function riderUpdateStatus(riderId, newStatus) {
  await sb.from('riders').update({ status: newStatus }).eq('id', riderId);
  toast('Status set to ' + newStatus);
}

// ── C5. Realtime: Watch for new assignment ───────────────────
function riderSubscribeRealtime(riderId) {
  sb.channel('rider-orders-' + riderId)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'orders',
      filter: `rider_id=eq.${riderId}`
    }, () => {
      riderLoadData();
      toast('New order assigned! 🛵');
    })
    .subscribe();
}
