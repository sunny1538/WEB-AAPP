// ============================================================
// tildabite_supabase.js  — ONE shared file, included by all 3 portals
// (tildabite_customer.html · tildabite_admin.html · tildabite_rider.html)
//
// Project: adrswghozchfbazwfnzr.supabase.co
// Make sure the SQL migration (tildabite_schema.sql, section 13) has been
// run on THIS project — RLS policies, riders login_id/password, and
// Realtime publication all need to exist here for the apps to work.
// ============================================================

const SUPABASE_URL  = 'https://adrswghozchfbazwfnzr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkcnN3Z2hvemNoZmJhendmbnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTc5MzcsImV4cCI6MjA5ODQ5MzkzN30.VAKnkX_bmESeQsKtpphVc7zpxdiLNZslofcmc3mWMMc';

// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> must load BEFORE this file
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 10 } }
});

const MIN_ORDER = 99; // ₹ minimum order value (shared constant)

// ============================================================
// MAPPERS — DB rows  <->  shape used by the existing UI code
// ============================================================
function dbMenuToLocal(m){
  return {
    id: m.id, name: m.name, desc: m.description, price: m.price,
    cat: m.category, emoji: m.emoji, veg: m.is_veg,
    image: m.image_url || '',
    stock: (m.stock_qty === null || m.stock_qty === undefined) ? null : m.stock_qty,
    oos: !!m.is_out_of_stock, bestseller: !!m.is_bestseller,
    sold: m.sold_count || 0, active: m.is_active
  };
}
function localMenuToDb(p){
  return {
    name: p.name, description: p.desc, price: p.price, category: p.cat,
    emoji: p.emoji, is_veg: p.veg, image_url: p.image || null,
    stock_qty: (p.stock === '' || p.stock === undefined || p.stock === null) ? null : p.stock,
    is_out_of_stock: !!p.oos, is_bestseller: !!p.bestseller,
    is_active: p.active !== false
  };
}
function fmtTime(iso){ return new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); }
function fmtDate(iso){ return new Date(iso).toLocaleDateString('en-IN'); }
function genOtp(){ return String(Math.floor(1000 + Math.random()*9000)); }
function playBeep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime+0.18);
  }catch(e){}
}

// ============================================================
// A. CUSTOMER APP
// ============================================================

async function customerLoadMenu(){
  const { data, error } = await sb.from('menu_items').select('*').eq('is_active', true).order('id');
  if(error){ console.error('loadMenu', error); return []; }
  return data.map(dbMenuToLocal);
}

function customerSubscribeMenu(onChange){
  return sb.channel('customer-menu')
    .on('postgres_changes', { event:'*', schema:'public', table:'menu_items' }, () => onChange())
    .subscribe();
}

async function customerSignUp(email, password, fullName, phone){
  const { data, error } = await sb.auth.signUp({
    email, password, options: { data: { full_name: fullName } }
  });
  if(error) return { error };
  if(data.user){
    await sb.from('profiles').update({ phone, full_name: fullName }).eq('id', data.user.id);
  }
  return { data };
}

async function customerSignIn(email, password){
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function customerSignOut(){ await sb.auth.signOut(); }

async function customerGetProfile(userId){
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

// items: [{id,name,qty,price}]
async function customerPlaceOrder({ address, paymentMethod, items, sub, tax, userId, customerName, customerPhone }){
  const otp = genOtp();
  const { data, error } = await sb.from('orders').insert({
    user_id: userId,
    customer_name: customerName,
    customer_phone: customerPhone || '—',
    delivery_address: address,
    items, subtotal: sub, tax, total: sub + tax,
    payment_method: paymentMethod,
    delivery_otp: otp,
    status: 'pending'
  }).select().single();
  if(error) return { error };
  return { data, otp };
}

async function customerLoadOrders(userId){
  const { data, error } = await sb.from('orders')
    .select('*').eq('user_id', userId).order('created_at', { ascending:false });
  if(error){ console.error('loadOrders', error); return []; }
  return data.map(o => ({
    id: o.id, date: fmtDate(o.created_at), status: o.status,
    items: (o.items||[]).map(i => `${i.name} ×${i.qty}`),
    total: o.total, otp: o.delivery_otp
  }));
}

function customerSubscribeOrders(userId, onUpdate){
  return sb.channel('customer-orders-'+userId)
    .on('postgres_changes', {
      event:'UPDATE', schema:'public', table:'orders', filter:`user_id=eq.${userId}`
    }, payload => onUpdate(payload.new))
    .subscribe();
}

// ============================================================
// B. ADMIN DASHBOARD
// (Admin gate is a simple client-side check; DB writes use permissive
//  RLS policies added in the SQL — fine for a solo/small project, but
//  understand that means anyone with the anon key can write these
//  tables too. Move to Edge Functions + service role if this ever
//  needs to be locked down.)
// ============================================================

async function adminLoadOrders(){
  const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending:false });
  if(error){ console.error('adminLoadOrders', error); return []; }
  return data.map(o => ({
    id:o.id, customer:o.customer_name || '—', time:fmtTime(o.created_at),
    amount:o.total, status:o.status, rider:o.rider_name||null, rider_id:o.rider_id||null,
    otp:o.delivery_otp||null, address:o.delivery_address||'—',
    items:(o.items||[]).map(i=>`${i.name} ×${i.qty}`)
  }));
}

async function adminLoadRiders(){
  const { data, error } = await sb.from('riders').select('*').order('name');
  if(error){ console.error('adminLoadRiders', error); return []; }
  return data.map(r => ({
    id:r.id, name:r.name, phone:r.phone, rating:r.rating,
    deliveries:r.total_deliveries, orders:0, status:r.status
  }));
}

async function adminAssignRider(orderId, riderId, riderName){
  const { error } = await sb.from('orders').update({
    rider_id: riderId, rider_name: riderName, status: 'otw'
  }).eq('id', orderId);
  if(error) return { error };
  await sb.from('riders').update({ status:'busy' }).eq('id', riderId);
  return { ok:true };
}

async function adminLoadMenuItems(){
  const { data, error } = await sb.from('menu_items').select('*').order('id');
  if(error){ console.error('adminLoadMenuItems', error); return []; }
  return data.map(dbMenuToLocal);
}

async function adminSaveMenuItem(payload, editingId){
  const dbPayload = localMenuToDb(payload);
  if(editingId){
    return await sb.from('menu_items').update(dbPayload).eq('id', editingId);
  }
  return await sb.from('menu_items').insert(dbPayload);
}

async function adminDeleteMenuItem(id){
  return await sb.from('menu_items').delete().eq('id', id);
}

async function adminLoadNotifications(){
  const { data, error } = await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(20);
  if(error){ console.error('adminLoadNotifications', error); return []; }
  return data.map(n => ({ type:n.type, title:n.title, msg:n.message, time:fmtTime(n.created_at), target:n.target }));
}

async function adminSendNotification(type, title, message, target){
  return await sb.from('notifications').insert({ type, title, message, target });
}

// Wires up all 4 realtime channels admin needs. Pass callbacks — the
// HTML file supplies its own render functions so this file stays UI-agnostic.
function adminSubscribeRealtime({ onOrders, onRiders, onMenu, onNotif }){
  const chans = [];
  chans.push(
    sb.channel('admin-orders')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'orders' }, () => { playBeep(); onOrders && onOrders(); })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' }, () => onOrders && onOrders())
      .subscribe()
  );
  chans.push(
    sb.channel('admin-riders')
      .on('postgres_changes', { event:'*', schema:'public', table:'riders' }, () => onRiders && onRiders())
      .subscribe()
  );
  chans.push(
    sb.channel('admin-menu')
      .on('postgres_changes', { event:'*', schema:'public', table:'menu_items' }, () => onMenu && onMenu())
      .subscribe()
  );
  chans.push(
    sb.channel('admin-notifications')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications' }, () => onNotif && onNotif())
      .subscribe()
  );
  return chans;
}

// ============================================================
// C. RIDER DASHBOARD
// (Simple login_id/password check against the riders table — same
//  security tradeoff as the admin gate above. See SQL migration.)
// ============================================================

async function riderLoginDb(loginId, password){
  const { data, error } = await sb.from('riders').select('*').eq('login_id', loginId).maybeSingle();
  if(error || !data) return { error: 'not_found' };
  if(data.password !== password) return { error: 'bad_password' };
  return { rider: data };
}

async function riderLoadOrders(riderId){
  const { data: active, error } = await sb.from('orders')
    .select('*').eq('rider_id', riderId).eq('status','otw').order('created_at',{ascending:false});
  if(error) console.error('riderLoadOrders active', error);

  const { data: hist } = await sb.from('orders')
    .select('*').eq('rider_id', riderId).eq('status','delivered')
    .order('updated_at',{ascending:false}).limit(15);

  return {
    active: (active||[]).map(o => ({
      id:o.id, customer:o.customer_name||'—', phone:o.customer_phone||'—',
      items:(o.items||[]).map(i=>`${i.name} ×${i.qty}`).join(', '),
      amount:o.total, address:o.delivery_address||'—', otp:o.delivery_otp, stage:'otw'
    })),
    history: (hist||[]).map(o => ({ id:o.id, customer:o.customer_name||'—', amount:o.total, status:'delivered' }))
  };
}

async function riderVerifyOtpDb(orderId, riderId, entered){
  const { data: ord, error } = await sb.from('orders').select('delivery_otp, rider_id, total').eq('id', orderId).single();
  if(error || !ord) return { error: 'not_found' };
  if(ord.rider_id !== riderId) return { error: 'not_yours' };
  if(String(ord.delivery_otp) !== String(entered)) return { error: 'wrong_otp' };

  const { error: updErr } = await sb.from('orders').update({ status:'delivered', otp_verified:true }).eq('id', orderId);
  if(updErr) return { error: 'update_failed' };

  // free the rider up + bump their stats
  const { data: riderRow } = await sb.from('riders').select('total_deliveries, today_deliveries, today_earnings').eq('id', riderId).single();
  await sb.from('riders').update({
    status: 'available',
    total_deliveries: (riderRow?.total_deliveries||0) + 1,
    today_deliveries: (riderRow?.today_deliveries||0) + 1,
    today_earnings: (riderRow?.today_earnings||0) + Math.round(ord.total * 0.1) // simple 10% payout model
  }).eq('id', riderId);

  return { ok:true };
}

async function riderSetStatus(riderId, status){
  return await sb.from('riders').update({ status }).eq('id', riderId);
}

function riderSubscribeRealtime(riderId, onChange){
  return sb.channel('rider-orders-'+riderId)
    .on('postgres_changes', {
      event:'*', schema:'public', table:'orders', filter:`rider_id=eq.${riderId}`
    }, () => onChange())
    .subscribe();
}
