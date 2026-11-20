-- One-off data fix, NOT a schema migration: gives the coach profile whose subscription is switched on
-- the 36 Stripe payment links (4 analysis types x 3 frequencies x 3 terms), created in the coach's Stripe account.
-- It only edits the subscription_offer JSON: it gives the four analysis types stable ids (matched by price:
-- 20 quick, 50 indepth, 100 complete, 500 elite EUR) and adds comboLinks. Titles, prices and descriptions are untouched.
-- 1) CHECK FIRST: this must return exactly one row (your profile).
--    select id, slug, name from public.coach_profiles where subscription_offer->>'enabled' = 'true';
-- 2) Then run the update.
update public.coach_profiles
set subscription_offer = jsonb_set(
  jsonb_set(
    subscription_offer,
    '{offers}',
    (select jsonb_agg(
       case (o->>'unitCents')::int
         when 2000  then o || '{"id":"quick"}'::jsonb
         when 5000  then o || '{"id":"indepth"}'::jsonb
         when 10000 then o || '{"id":"complete"}'::jsonb
         when 50000 then o || '{"id":"elite"}'::jsonb
         else o end)
     from jsonb_array_elements(subscription_offer->'offers') o)
  ),
  '{comboLinks}',
  '{"quick|weekly|monthly12":"https://buy.stripe.com/6oU6oHgsN4j2evCcIm7kc0q","quick|weekly|prepaid6":"https://buy.stripe.com/eVq4gz90l9Dmcnu23I7kc0p","quick|weekly|prepaid12":"https://buy.stripe.com/4gM8wPa4p6ra9bibEi7kc0r","quick|biweekly|monthly12":"https://buy.stripe.com/fZu14nekFg1KfzGbEi7kc0s","quick|biweekly|prepaid6":"https://buy.stripe.com/5kQ7sLgsN7vebjq6jY7kc0t","quick|biweekly|prepaid12":"https://buy.stripe.com/4gM6oHgsN5n6dry7o27kc0u","quick|monthly|monthly12":"https://buy.stripe.com/5kQfZh4K57ve2MU8s67kc0v","quick|monthly|prepaid6":"https://buy.stripe.com/cNi00jfoJg1KgDK8s67kc0w","quick|monthly|prepaid12":"https://buy.stripe.com/00w00j7Wh2aUdry0ZE7kc0x","indepth|weekly|monthly12":"https://buy.stripe.com/00w7sLb8teXGafm5fU7kc0y","indepth|weekly|prepaid6":"https://buy.stripe.com/00w7sL3G14j2dryfUy7kc0z","indepth|weekly|prepaid12":"https://buy.stripe.com/bJe6oH7WhcPyfzG6jY7kc0A","indepth|biweekly|monthly12":"https://buy.stripe.com/7sYfZhfoJaHq5Z6eQu7kc0B","indepth|biweekly|prepaid6":"https://buy.stripe.com/28EcN54K59Dm0EMfUy7kc0C","indepth|biweekly|prepaid12":"https://buy.stripe.com/8x27sLccxdTCafm5fU7kc0D","indepth|monthly|monthly12":"https://buy.stripe.com/fZubJ1foJ7vegDK8s67kc0E","indepth|monthly|prepaid6":"https://buy.stripe.com/dRm7sLfoJ5n6gDKbEi7kc0F","indepth|monthly|prepaid12":"https://buy.stripe.com/3cI7sL7WheXG0EM37M7kc0G","complete|weekly|monthly12":"https://buy.stripe.com/4gMbJ12BXaHqgDK37M7kc0H","complete|weekly|prepaid6":"https://buy.stripe.com/4gMcN53G13eY4V27o27kc0I","complete|weekly|prepaid12":"https://buy.stripe.com/3cIfZh3G1bLu9bi8s67kc0J","complete|biweekly|monthly12":"https://buy.stripe.com/cNidR93G14j2evC8s67kc0K","complete|biweekly|prepaid6":"https://buy.stripe.com/6oUdR97WhdTC4V28s67kc0L","complete|biweekly|prepaid12":"https://buy.stripe.com/8x25kD2BXg1KbjqeQu7kc0M","complete|monthly|monthly12":"https://buy.stripe.com/eVq9AT6SdbLubjqfUy7kc0N","complete|monthly|prepaid6":"https://buy.stripe.com/3cI28r0tPeXG9bi23I7kc0O","complete|monthly|prepaid12":"https://buy.stripe.com/4gM6oH7WhdTC1IQ37M7kc0P","elite|weekly|monthly12":"https://buy.stripe.com/9B6aEX90l02M9bi5fU7kc0Q","elite|weekly|prepaid6":"https://buy.stripe.com/dRm8wPdgB8zi9bibEi7kc0R","elite|weekly|prepaid12":"https://buy.stripe.com/cNi8wP90lcPy1IQ9wa7kc0S","elite|biweekly|monthly12":"https://buy.stripe.com/eVqbJ15O9cPy2MUcIm7kc0T","elite|biweekly|prepaid6":"https://buy.stripe.com/fZufZh5O9bLugDK0ZE7kc0U","elite|biweekly|prepaid12":"https://buy.stripe.com/3cIfZh4K57ve4V2dMq7kc0V","elite|monthly|monthly12":"https://buy.stripe.com/cNi8wPdgBaHq3QY7o27kc0W","elite|monthly|prepaid6":"https://buy.stripe.com/8x200ja4paHq2MU5fU7kc0X","elite|monthly|prepaid12":"https://buy.stripe.com/9B6dR97WhbLu4V223I7kc0Y"}'::jsonb
)
where subscription_offer->>'enabled' = 'true';
