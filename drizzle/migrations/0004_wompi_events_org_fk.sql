-- Add FK constraint on wompi_events.organization_id referencing organizations.id
-- Ensures referential integrity: every Wompi event belongs to an existing organization.

ALTER TABLE `wompi_events` ADD CONSTRAINT `fk_wompi_events_organization_id`
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE NO ACTION ON DELETE NO ACTION;