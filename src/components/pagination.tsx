import {
  Pagination as PaginationRoot,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function currentPage(page: number, total: number, pageSize: number) {
  return Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
}

export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange }: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  if (total <= pageSize) return null;
  const lastPage = Math.ceil(total / pageSize) - 1;
  const shownPage = currentPage(page, total, pageSize);
  const go = (nextPage: number) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (nextPage >= 0 && nextPage <= lastPage && nextPage !== shownPage) onPageChange(nextPage);
  };
  const pageNumbers = Array.from({ length: lastPage + 1 }, (_, index) => index)
    .filter((index) => index === 0 || index === lastPage || Math.abs(index - shownPage) <= 1);
  return <div className="pagination-controls">
    <div className="pagination-settings">
      <span className="small-muted">共 {total} 条</span>
      <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
        <SelectTrigger size="sm" className="w-[96px]" aria-label="每页条数"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}条/页</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
    </div>
    <PaginationRoot className="mx-0 w-auto max-w-full justify-end">
      <PaginationContent>
        <PaginationItem><PaginationPrevious href="#" aria-disabled={shownPage === 0} tabIndex={shownPage === 0 ? -1 : undefined} onClick={go(shownPage - 1)} /></PaginationItem>
        {pageNumbers.map((pageNumber, index) => {
          const previous = pageNumbers[index - 1];
          const needsEllipsis = previous !== undefined && pageNumber - previous > 1;
          return <React.Fragment key={pageNumber}>
            {needsEllipsis && <PaginationItem><PaginationEllipsis /></PaginationItem>}
            <PaginationItem><PaginationLink href="#" isActive={pageNumber === shownPage} onClick={go(pageNumber)}>{pageNumber + 1}</PaginationLink></PaginationItem>
          </React.Fragment>;
        })}
        <PaginationItem><PaginationNext href="#" aria-disabled={shownPage === lastPage} tabIndex={shownPage === lastPage ? -1 : undefined} onClick={go(shownPage + 1)} /></PaginationItem>
      </PaginationContent>
    </PaginationRoot>
  </div>;
}
