import { useState, useEffect, useCallback, memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { X, Send, Trash2, Pencil, Check, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import type { Job, JobComment } from "@shared/schema";

interface CommentsSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
}

export default function CommentsSidebar({ open, onOpenChange, job }: CommentsSidebarProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const { data: comments = [], isLoading } = useQuery<(JobComment & { author: any })[]>({
    queryKey: ["/api/jobs", job.id, "comments"],
    enabled: !!job?.id,
  });

  const { data: office } = useQuery({
    queryKey: ["/api/offices", user?.officeId],
    enabled: !!user?.officeId,
  });

  const addCommentMutation = useMutation({
    mutationFn: async (input: { content: string; clientCommentId: string }) => {
      const res = await apiRequest("POST", `/api/jobs/${job.id}/comments`, {
        id: input.clientCommentId,
        content: input.content.trim(),
      });
      return res.json();
    },
    onMutate: async (input) => {
      const queryKey = ["/api/jobs", job.id, "comments"];
      
      // Only cancel if query exists in cache
      const queriesInCache = queryClient.getQueryCache().find({ queryKey });
      
      if (queriesInCache) {
        await queryClient.cancelQueries({ queryKey });
      }
      
      const previousComments = queryClient.getQueryData(queryKey);
      
      // Only update cache if data exists
      if (previousComments) {
        const optimisticComment = {
          id: input.clientCommentId,
          jobId: job.id,
          authorId: user?.id || '',
          content: input.content.trim(),
          createdAt: new Date(),
          author: {
            id: user?.id || '',
            firstName: user?.firstName || '',
            lastName: user?.lastName || '',
          },
        };
        
        queryClient.setQueryData(queryKey, (old: any[] | undefined) => 
          old ? [...old, optimisticComment] : [optimisticComment]
        );
      }
      
      return { previousComments };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/jobs", job.id, "comments"], context?.previousComments);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      setNewComment("");
      toast({
        title: "Success",
        description: "Comment added successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/unread-comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/comment-counts"] });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await apiRequest("DELETE", `/api/jobs/comments/${commentId}`);
    },
    onMutate: async (commentId) => {
      const queryKey = ["/api/jobs", job.id, "comments"];
      
      // Only cancel if query exists in cache
      const queriesInCache = queryClient.getQueryCache().find({ queryKey });
      
      if (queriesInCache) {
        await queryClient.cancelQueries({ queryKey });
      }
      
      const previousComments = queryClient.getQueryData(queryKey);
      
      // Only update cache if data exists
      if (previousComments) {
        queryClient.setQueryData(queryKey, (old: any[] | undefined) => 
          old ? old.filter(comment => comment.id !== commentId) : []
        );
      }
      
      return { previousComments };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/jobs", job.id, "comments"], context?.previousComments);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Comment deleted successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/comment-counts"] });
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, content }: { commentId: string; content: string }) => {
      const res = await apiRequest("PUT", `/api/jobs/comments/${commentId}`, {
        content: content.trim(),
        jobId: job.id,
      });
      return res.json();
    },
    onMutate: async ({ commentId, content }) => {
      const queryKey = ["/api/jobs", job.id, "comments"];
      
      // Only cancel if query exists in cache
      const queriesInCache = queryClient.getQueryCache().find({ queryKey });
      
      if (queriesInCache) {
        await queryClient.cancelQueries({ queryKey });
      }
      
      const previousComments = queryClient.getQueryData(queryKey);
      
      // Only update cache if data exists
      if (previousComments) {
        queryClient.setQueryData(queryKey, (old: any[] | undefined) => 
          old ? old.map(comment => 
            comment.id === commentId ? { ...comment, content: content.trim() } : comment
          ) : []
        );
      }
      
      return { previousComments };
    },
    onError: (error: Error, variables, context) => {
      queryClient.setQueryData(["/api/jobs", job.id, "comments"], context?.previousComments);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      setEditingCommentId(null);
      setEditContent("");
      toast({
        title: "Success",
        description: "Comment updated successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id, "comments"] });
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("PUT", `/api/jobs/${jobId}/comment-reads`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/unread-comments"] });
    },
  });

  useEffect(() => {
    if (open && job?.id) {
      markAsReadMutation.mutate(job.id);
    }
  }, [open, job?.id]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      const id =
        (globalThis as any)?.crypto?.randomUUID?.() ||
        `comment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      addCommentMutation.mutate({ content: newComment, clientCommentId: id });
    }
  }, [newComment, addCommentMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (newComment.trim()) {
        const id =
          (globalThis as any)?.crypto?.randomUUID?.() ||
          `comment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        addCommentMutation.mutate({ content: newComment, clientCommentId: id });
      }
    }
  }, [newComment, addCommentMutation]);

  const handleDeleteComment = useCallback((commentId: string) => {
    if (confirm("Are you sure you want to delete this comment?")) {
      deleteCommentMutation.mutate(commentId);
    }
  }, [deleteCommentMutation]);

  const handleEditComment = useCallback((comment: JobComment) => {
    setEditingCommentId(comment.id);
    setEditContent(comment.content);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingCommentId && editContent.trim()) {
      updateCommentMutation.mutate({ 
        commentId: editingCommentId, 
        content: editContent 
      });
    }
  }, [editingCommentId, editContent, updateCommentMutation]);

  const handleCancelEdit = useCallback(() => {
    setEditingCommentId(null);
    setEditContent("");
  }, []);

  const getInitials = (firstName?: string, lastName?: string) => {
    if (!firstName && !lastName) return "?";
    return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  };

  if (!open) return null;

  return (
    <div
      className="fixed top-0 right-0 h-full w-96 bg-card border-l border-border shadow-hard animate-slide-in-right z-50 flex flex-col"
      data-testid="sidebar-comments"
    >
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Comments</h3>
          <p className="text-sm text-muted-foreground">
            Order #{job.orderId}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          data-testid="button-close-comments"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading comments...
          </div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No comments yet. Be the first to add one!
          </div>
        ) : (
          comments.map((comment: JobComment & { author: any }) => (
            <div key={comment.id} className="flex gap-3 group" data-testid={`comment-${comment.id}`}>
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                {getInitials(comment.author?.firstName, comment.author?.lastName)}
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                  <span className="font-semibold text-sm">
                    {comment.author?.firstName} {comment.author?.lastName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                  </span>
                  {(comment as any).isOverdueComment && (
                    <Badge 
                      variant="destructive" 
                      className="h-5 px-2 text-xs"
                      data-testid={`badge-overdue-comment-${comment.id}`}
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Overdue
                    </Badge>
                  )}
                  {comment.authorId === user?.id && editingCommentId !== comment.id && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => handleEditComment(comment)}
                        data-testid={`button-edit-comment-${comment.id}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => handleDeleteComment(comment.id)}
                        data-testid={`button-delete-comment-${comment.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
                {editingCommentId === comment.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="resize-none"
                      rows={3}
                      data-testid={`textarea-edit-comment-${comment.id}`}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={!editContent.trim() || updateCommentMutation.isPending}
                        data-testid={`button-save-comment-${comment.id}`}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancelEdit}
                        disabled={updateCommentMutation.isPending}
                        data-testid={`button-cancel-edit-${comment.id}`}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground bg-muted p-3 rounded-lg">
                    {comment.content}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Comment Input */}
      <div className="p-4 border-t border-border">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment... (Press Enter to send, Shift+Enter for new line)"
            className="flex-1 resize-none"
            rows={2}
            data-testid="textarea-new-comment"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!newComment.trim() || addCommentMutation.isPending}
            data-testid="button-send-comment"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
