# Turf booking (Sports Turf business)

## 1. Create the business in the portal

1. Register / sign in → **Settings** → business setup (or guided onboarding).
2. Choose business type **`Sports Turf / Ground`** (`sports_turf`).
3. Select use case **`Appointment Booking`** (`appointment_booking`).
4. Set **timezone** (e.g. `Asia/Kolkata`) under scheduling settings.

## 2. Resources = turfs / courts

In **Scheduling → Resources**, create one row per bookable surface, for example:

| Name | Type | Notes |
|------|------|--------|
| Turf A | turf | 5-a-side |
| Turf B | turf | 7-a-side |
| Cricket Net 1 | net | 30-min slots |

Add **weekly schedules** and **slot length** (e.g. 60 minutes) per resource.

## 3. Services (WhatsApp menu)

Default services for `sports_turf` include Turf booking, Cricket net, Football turf, Event slot.  
Customize under **Settings → Appointment services** (or salon services key in API).

## 4. Workflow

1. **Settings → Workflows** → sync / publish **Live appointment booking** (same flow as salon: service → date → resource → time of day → slot → book).
2. Map trigger keywords (e.g. `book`, `turf`, `slot`) on the published workflow.
3. Customers use interactive lists: **Today/Tomorrow**, pick turf, **Morning/Afternoon/Evening/Night**, then a slot.

## 5. Owner approval

Bookings are created **pending** until the owner approves in the app; WhatsApp confirmation is sent after approval (existing booking notification flow).

## 6. Tips

- Use **one resource per turf** so “Other stylist” retry label maps to “another turf” in practice (rename copy in workflow node messages if needed).
- For peak hours, keep slot length fixed (60 min) so `list_slots` stays readable (max 10 list rows per message).
